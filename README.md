# OpenFork Desktop

**Your Personal AI Video Studio.**

This app connects your computer to [openfork.video](https://openfork.video) — a GitHub-like platform for AI video collaboration and workflow automation.

### What it does

*   **Generate Locally**: Use your own GPU to render your video scenes, images or audio. It costs nothing, respects your privacy, and gives you full control.
*   **Trade Compute**: Rate limit? What rate limit? Share your idle GPU with the network to earn credits. Use those credits to rent *other* people's GPUs instantly—perfect for when you need to render 5 variations at once instead of waiting for your single card.
*   **Support & Collaborate**: Point your idle compute at specific projects or friends to help them finish their movies faster.

**Zero Setup**: We distinguish ourselves by handling the complex AI models (Wan2.1, Hunyuan, etc) and Docker containers automatically behind the scenes. You just click "Start".

The app wraps our open-source [Python Client](https://github.com/besch/openfork_client), ensuring you run the exact same verified code as the rest of the network.

---

## For Developers

This directory contains the source code for the Electron-based desktop application.

### Tech Stack
*   **Electron**: Application shell.
*   **React**: UI.
*   **Python**: Underlying logic (managed as a subprocess).
*   **Docker**: Used to isolate and execute AI models.

### Setup (Developer Mode)

**Prerequisites**: Node.js v18+, Python 3.10+, Git, Docker Desktop.

**One-Click Setup**:
1.  Run the initialization script (installs deps & creates Python venv):
    ```bash
    cd desktop
    npm run setup:dev
    ```
2.  Start the full stack (UI + Electron + Python Client from source):
    ```bash
    npm run dev:all
    ```

**Note**: This runs the Python client directly from source (`../client/dgn_client.py`), so you don't need to rebuild executables to test changes. The application will automatically detect the virtual environment created by `setup:dev`.