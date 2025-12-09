# OpenFork Desktop

**Your Personal AI Video Studio.**

This app connects your computer to [openfork.video](https://openfork.video) — a GitHub-like platform for AI video collaboration and workflow automation.

### What it does

*   **Generate Locally**: Use your own GPU to render your video scenes, images or audio. It costs nothing, respects your privacy, and gives you full control.
*   **Trade Compute**: Rate limit? What rate limit? Share your idle GPU with the network to earn credits. Use those credits to rent *other* people's GPUs instantly—perfect for when you need to render 5 variations at once instead of waiting for your single card.
*   **Support & Collaborate**: Point your idle compute at specific projects or friends to help them finish their movies faster.

**Zero Setup**: We distinguish ourselves by handling the complex AI models (Wan2.1, Hunyuan, etc) and Docker containers automatically behind the scenes. You just click "Start".

---

## For Developers

This directory contains the source code for the Electron-based desktop application.

### Tech Stack
*   **Electron**: Application shell.
*   **React**: UI.
*   **Python**: Underlying logic (managed as a subprocess).
*   **Docker**: Used to isolate and execute AI models.

### Setup

1.  **Prerequisites**: Node.js, Python 3.10+, Docker Desktop.
2.  **Install**:
    ```bash
    cd desktop
    npm install
    ```
3.  **Run**:
    ```bash
    npm run dev
    ```