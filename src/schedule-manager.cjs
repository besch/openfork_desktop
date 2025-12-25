const { powerMonitor } = require("electron");

/**
 * ScheduleManager handles automatic starting and stopping of the DGN client
 * based on time schedules, idle detection, and power status.
 */
class ScheduleManager {
  constructor({ pythonManager, store, mainWindow }) {
    this.pythonManager = pythonManager;
    this.store = store;
    this.mainWindow = mainWindow;
    this.config = null;
    this.checkInterval = null;
    this.isEnabled = false;
  }

  /**
   * Load and apply the saved schedule configuration
   */
  loadConfig() {
    const savedConfig = this.store.get("autoScheduleConfig");
    if (savedConfig) {
      this.config = savedConfig;
      this.isEnabled = savedConfig.mode !== "manual";
      console.log("ScheduleManager: Loaded config:", this.config);
    }
  }

  /**
   * Update the schedule configuration
   */
  updateConfig(config) {
    this.config = config;
    this.store.set("autoScheduleConfig", config);
    
    if (config?.mode !== "manual") {
      this.isEnabled = true;
      this.startMonitoring();
    } else {
      this.isEnabled = false;
      this.stopMonitoring();
    }
    
    console.log("ScheduleManager: Config updated:", config);
  }

  /**
   * Start the monitoring interval
   */
  startMonitoring() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    
    // Check every 30 seconds
    this.checkInterval = setInterval(() => this.checkAndApply(), 30000);
    
    // Immediate check
    this.checkAndApply();
    
    console.log("ScheduleManager: Monitoring started");
  }

  /**
   * Stop the monitoring interval
   */
  stopMonitoring() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    console.log("ScheduleManager: Monitoring stopped");
  }

  /**
   * Check conditions and start/stop client accordingly
   */
  checkAndApply() {
    if (!this.isEnabled || !this.config) {
      return;
    }

    const shouldRun = this.shouldClientBeRunning();
    const isRunning = this.pythonManager.isRunning();

    if (shouldRun && !isRunning) {
      console.log("ScheduleManager: Starting DGN client (scheduled)...");
      // Get stored job policy settings
      const jobPolicy = this.store.get("jobPolicy") || "mine";
      const allowedIds = this.store.get("allowedIds") || "";
      this.pythonManager.start("auto", jobPolicy, allowedIds);
    } else if (!shouldRun && isRunning) {
      console.log("ScheduleManager: Stopping DGN client (schedule ended)...");
      this.pythonManager.stop();
    }

    // Notify UI of schedule status
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("schedule:status", {
        shouldRun,
        isRunning,
        mode: this.config.mode,
        nextCheck: new Date(Date.now() + 30000).toISOString(),
      });
    }
  }

  /**
   * Determine if the client should be running based on current config
   */
  shouldClientBeRunning() {
    if (!this.config || this.config.mode === "manual") {
      return false;
    }

    // Check battery first (applies to all modes)
    if (this.config.pauseOnBattery) {
      try {
        const isOnBattery = !powerMonitor.isOnBatteryPower();
        // Note: isOnBatteryPower returns true when NOT plugged in
        if (powerMonitor.isOnBatteryPower()) {
          console.log("ScheduleManager: On battery power, pausing");
          return false;
        }
      } catch (err) {
        // powerMonitor might not be available in all environments
        console.warn("ScheduleManager: Could not check battery status:", err.message);
      }
    }

    if (this.config.mode === "scheduled") {
      return this.isWithinScheduledTime();
    }

    if (this.config.mode === "idle") {
      const idleSeconds = powerMonitor.getSystemIdleTime();
      const requiredSeconds = (this.config.idleThresholdMinutes || 15) * 60;

      // If also requiring schedule, check that too
      if (this.config.idleOnlyDuringSchedule && !this.isWithinScheduledTime()) {
        return false;
      }

      return idleSeconds >= requiredSeconds;
    }

    return false;
  }

  /**
   * Check if current time is within any scheduled time window
   */
  isWithinScheduledTime() {
    const schedules = this.config.schedules || [];
    if (schedules.length === 0) {
      return false;
    }

    const now = new Date();
    const currentDay = now.getDay(); // 0=Sunday, 1=Monday, ...
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // Day mapping for config: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const currentDayName = dayNames[currentDay];

    for (const schedule of schedules) {
      // Check if current day is enabled
      if (!schedule.days || !schedule.days.includes(currentDayName)) {
        continue;
      }

      const [startH, startM] = schedule.startTime.split(":").map(Number);
      const [endH, endM] = schedule.endTime.split(":").map(Number);
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      // Handle overnight schedules (e.g., 22:00 - 08:00)
      if (startMinutes > endMinutes) {
        // Overnight: valid if after start OR before end
        if (currentMinutes >= startMinutes || currentMinutes < endMinutes) {
          return true;
        }
      } else {
        // Same day: valid if between start and end
        if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get the current schedule status for UI display
   */
  getStatus() {
    if (!this.config || this.config.mode === "manual") {
      return {
        mode: "manual",
        isActive: false,
        message: "Schedule is disabled",
      };
    }

    const shouldRun = this.shouldClientBeRunning();
    const isRunning = this.pythonManager.isRunning();

    let message;
    if (this.config.mode === "scheduled") {
      if (shouldRun) {
        message = "Within scheduled time - client should be running";
      } else {
        message = "Outside scheduled time - client paused";
      }
    } else if (this.config.mode === "idle") {
      const idleSeconds = powerMonitor.getSystemIdleTime();
      const requiredSeconds = (this.config.idleThresholdMinutes || 15) * 60;
      if (shouldRun) {
        message = `Computer idle for ${Math.floor(idleSeconds / 60)} minutes - client running`;
      } else {
        const remaining = Math.ceil((requiredSeconds - idleSeconds) / 60);
        message = `Waiting for ${remaining} more minutes of idle time`;
      }
    }

    return {
      mode: this.config.mode,
      isActive: shouldRun,
      isRunning,
      message,
      schedules: this.config.schedules,
    };
  }

  /**
   * Cleanup when app is closing
   */
  cleanup() {
    this.stopMonitoring();
    console.log("ScheduleManager: Cleaned up");
  }
}

// Preset schedule configurations
const SCHEDULE_PRESETS = {
  overnight: {
    mode: "scheduled",
    schedules: [
      {
        startTime: "22:00",
        endTime: "08:00",
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      },
    ],
    pauseOnBattery: true,
  },
  evening: {
    mode: "scheduled",
    schedules: [
      {
        startTime: "18:00",
        endTime: "23:00",
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      },
    ],
    pauseOnBattery: true,
  },
  workHours: {
    mode: "scheduled",
    schedules: [
      {
        startTime: "09:00",
        endTime: "17:00",
        days: ["mon", "tue", "wed", "thu", "fri"],
      },
    ],
    pauseOnBattery: true,
  },
  weekendsOnly: {
    mode: "scheduled",
    schedules: [
      {
        startTime: "00:00",
        endTime: "23:59",
        days: ["sat", "sun"],
      },
    ],
    pauseOnBattery: true,
  },
  alwaysOn: {
    mode: "scheduled",
    schedules: [
      {
        startTime: "00:00",
        endTime: "23:59",
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      },
    ],
    pauseOnBattery: false,
  },
  idle15: {
    mode: "idle",
    idleThresholdMinutes: 15,
    idleOnlyDuringSchedule: false,
    pauseOnBattery: true,
  },
  idle30: {
    mode: "idle",
    idleThresholdMinutes: 30,
    idleOnlyDuringSchedule: false,
    pauseOnBattery: true,
  },
};

module.exports = { ScheduleManager, SCHEDULE_PRESETS };
