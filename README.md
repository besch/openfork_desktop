# OpenFork Desktop Client

The OpenFork Desktop Client is the official desktop application for the [openfork.video](https://openfork.video) website. It provides a user-friendly graphical interface for the [DGN (Distributed GPU Network) Client](../client/README.md), allowing anyone to easily contribute their computer's processing power to the OpenFork network without needing to use the command line.

This directory contains the source code for the OpenFork Desktop Client, an application that provides a user-friendly graphical interface for the [DGN (Distributed GPU Network) Client](../client/README.md).

The desktop app allows anyone to easily contribute their computer's processing power to the OpenFork network without needing to use the command line.

## How it Works

The application is built with [Electron](https://www.electronjs.org/) and [React](https://react.dev/). Its primary responsibility is to manage the lifecycle of the underlying Python DGN client.

1.  **Authentication**: The app handles user login by opening the OpenFork website for authentication. Once the user logs in, the session is securely passed back to the desktop app.
2.  **Configuration**: It provides a simple UI where users can select their job acceptance policy (e.g., process jobs for everyone, only for their own projects, or for specific users/projects).
3.  **Process Management**: Users can start and stop the DGN client with the click of a button. The desktop app launches the Python script (`client/cli.py`) as a background process, passing the necessary authentication tokens and configuration.
4.  **Log Viewing**: The app captures and displays the logs from the running Python client, allowing users to monitor its activity and see which jobs are being processed.

## Core Components

-   **`electron.cjs`**: The main Electron process. It creates the application window, handles native OS integrations, and manages the Python background process.
-   **`src/python-process-manager.cjs`**: A dedicated module for starting, stopping, and communicating with the Python DGN client process.
-   **`preload.js`**: The Electron preload script that securely exposes specific backend functions (like authentication and process management) to the React frontend.
-   **`src/App.tsx`**: The main React component that renders the entire user interface.
-   **`src/components/`**: Contains the reusable React components for different parts of the UI, such as:
    -   `Auth.tsx`: The login screen.
    -   `Dashboard.tsx`: The main control panel for managing the client.
    -   `LogViewer.tsx`: The component for displaying logs.
    -   `JobPolicySettings.tsx`: The UI for configuring job acceptance rules.

## Development

### Prerequisites

-   [Node.js](https://nodejs.org/) (LTS version recommended)
-   [npm](https://www.npmjs.com/)
-   [Python](https://www.python.org/) (for the underlying DGN client)

### Installation

1.  Navigate to the `desktop` directory.
2.  Install the Node.js dependencies:
    ```bash
    npm install
    ```
3.  Install the Python dependencies for the DGN client (see the `client` directory's README).

### Running the App

To run the application in development mode with hot-reloading:

```bash
npm run dev
```

This will start the Vite development server for the React frontend and launch the Electron application.

## Building for Production

To build a distributable installer for your operating system (e.g., `.exe` for Windows, `.dmg` for macOS):

```bash
npm run build
npm run pack
```

The packaged application will be located in the `dist` folder.