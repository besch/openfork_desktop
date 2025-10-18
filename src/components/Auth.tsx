import { Button } from "@/components/ui/Button";

export function Auth() {
  const handleLogin = () => {
    window.electronAPI.loginWithGoogle();
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-50 bg-gray-900">
      <div className="p-8 bg-white bg-gray-800 rounded-lg shadow-md text-center">
        <h1 className="text-2xl font-bold mb-2 text-gray-900 text-white">
          Welcome to OpenFork Client
        </h1>
        <p className="mb-6 text-gray-600 text-gray-300">
          Please sign in to continue
        </p>
        <Button
          onClick={handleLogin}
          size="lg"
          style={{ backgroundColor: "#4285F4", color: "white" }}
        >
          Sign In with Google
        </Button>
      </div>
    </div>
  );
}
