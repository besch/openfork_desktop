import { useState } from 'react';
import { create } from 'zustand';
import { Home } from 'lucide-react';
import * as Effect from '@effect/core/Effect'; // Import Effect

// Zustand Store
interface CounterState {
  count: number;
  increment: () => void;
  decrement: () => void;
}

const useCounterStore = create<CounterState>((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
  decrement: () => set((state) => ({ count: state.count - 1 })),
}));

function App() {
  const { count, increment, decrement } = useCounterStore();

  // Simple Effect example (not executed, just to show import)
  const myEffect = Effect.succeed("Hello from Effect!");

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
      <h1 className="text-4xl font-bold mb-6 text-blue-400">
        DGN Client Desktop
      </h1>

      <div className="flex items-center space-x-4 mb-8">
        <Home size={48} className="text-green-500" />
        <p className="text-lg">Welcome to your Electron + React + Tailwind + Zustand + Effect app!</p>
      </div>

      <div className="bg-gray-800 p-6 rounded-lg shadow-lg flex flex-col items-center">
        <p className="text-2xl mb-4">Counter: {count}</p>
        <div className="flex space-x-4">
          <button
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
            onClick={increment}
          >
            Increment
          </button>
          <button
            className="px-6 py-2 bg-red-600 hover:bg-red-700 rounded-md transition-colors"
            onClick={decrement}
          >
            Decrement
          </button>
        </div>
      </div>

      <p className="mt-8 text-sm text-gray-400">
        Check console for Effect example (not actively used in UI).
      </p>
    </div>
  );
}

export default App;