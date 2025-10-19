import { Button } from "@/components/ui/Button";

export function Auth() {
  const handleLogin = () => {
    window.electronAPI.loginWithGoogle();
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-background">
      <div className="p-8 bg-card rounded-lg shadow-md text-center">
        <h1 className="text-2xl font-bold mb-2 text-card-foreground">
          Welcome to OpenFork Client
        </h1>
        <p className="mb-6 text-muted-foreground">
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