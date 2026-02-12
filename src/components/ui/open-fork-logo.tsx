"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface OpenForkLogoProps {
  className?: string;
  size?: number | string;
  animate?: boolean;
}

export function OpenForkLogo({ 
  className, 
  size = 48,
  animate = true 
}: OpenForkLogoProps) {
  return (
    <motion.svg
      width={size}
      height={typeof size === "number" ? size * 1.6 : size}
      viewBox="0 0 100 160"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("overflow-visible", className)}
      initial="initial"
      animate={animate ? "animate" : "initial"}
    >
      <defs>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
        <linearGradient id="logo-grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="currentColor" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.8" />
        </linearGradient>
      </defs>

      {/* Circle / Base */}
      <motion.path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M50 160C72.0914 160 90 142.091 90 120C90 97.9086 72.0914 80 50 80C27.9086 80 10 97.9086 10 120C10 142.091 27.9086 160 50 160ZM50 142C62.1503 142 72 132.15 72 120C72 107.85 62.1503 98 50 98C37.8497 98 28 107.85 28 120C28 132.15 37.8497 142 50 142Z"
        fill="url(#logo-grad)"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ 
          pathLength: 1, 
          opacity: [0.9, 1, 0.9],
          scale: [1, 1.05, 1],
          transition: { 
            pathLength: { duration: 1.5, ease: "easeInOut" },
            scale: { duration: 3, repeat: Infinity, ease: "easeInOut" },
            opacity: { duration: 3, repeat: Infinity, ease: "easeInOut" }
          } 
        }}
        style={{ filter: "url(#glow)" }}
      />

      {/* Connecting Stem */}
      <motion.path
        d="M44 82H56V50C56 45.5817 52.4183 42 48 42H52C47.5817 42 44 45.5817 44 50V82Z"
        fill="url(#logo-grad)"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ 
          pathLength: 1, 
          opacity: 1,
          transition: { 
            pathLength: { duration: 1, delay: 0.5, ease: "easeInOut" },
            opacity: { delay: 0.5 }
          } 
        }}
      />

      {/* The Fork Head */}
      <motion.path
        d="M25 45C25 49.4183 28.5817 53 33 53H67C71.4183 53 75 49.4183 75 45V15C75 10.5817 71.4183 7 67 7C62.5817 7 59 10.5817 59 15V40H41V15C41 10.5817 37.4183 7 33 7C28.5817 7 25 10.5817 25 15V45Z"
        fill="url(#logo-grad)"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ 
          pathLength: 1, 
          opacity: 1,
          y: [0, -4, 0],
          transition: { 
            pathLength: { duration: 1, delay: 0.8, ease: "easeInOut" },
            opacity: { delay: 0.8 },
            y: { duration: 3, repeat: Infinity, ease: "easeInOut", delay: 1.8 }
          } 
        }}
      />

      {/* Middle Vertical Branch */}
      <motion.rect
        x="42"
        y="7"
        width="16"
        height="35"
        rx="8"
        fill="url(#logo-grad)"
        initial={{ opacity: 0, scaleY: 0 }}
        animate={{ 
          opacity: 1,
          scaleY: 1,
          height: [35, 42, 35],
          y: [7, 0, 7],
          transition: { 
            opacity: { delay: 1 },
            scaleY: { duration: 0.8, delay: 1, ease: "easeOut" },
            height: { duration: 3, repeat: Infinity, ease: "easeInOut", delay: 1.8 },
            y: { duration: 3, repeat: Infinity, ease: "easeInOut", delay: 1.8 }
          } 
        }}
        style={{ transformOrigin: "bottom" }}
      />

      {/* Orbiting Tech Particles */}
      {animate && [0, 120, 240].map((angle, i) => (
        <motion.circle
          key={i}
          r="3"
          fill="currentColor"
          variants={{
            animate: {
              cx: [
                50 + 55 * Math.cos((angle * Math.PI) / 180),
                50 + 55 * Math.cos(((angle + 360) * Math.PI) / 180),
              ],
              cy: [
                120 + 55 * Math.sin((angle * Math.PI) / 180),
                120 + 55 * Math.sin(((angle + 360) * Math.PI) / 180),
              ],
              opacity: [0, 1, 0.5, 1, 0],
              transition: { 
                duration: 4, 
                repeat: Infinity, 
                ease: "linear",
                times: [0, 0.2, 0.5, 0.8, 1]
              }
            }
          }}
        />
      ))}
    </motion.svg>
  );
}
