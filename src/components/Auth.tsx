import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function Auth() {
  const handleLogin = () => {
    window.electronAPI.loginWithGoogle();
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-background via-background/95 to-background/90 p-4">
      <div className="w-full max-w-md">
        <Card className="bg-card/80 backdrop-blur-sm border-border/50 shadow-2xl hover:shadow-3xl transition-all duration-300">
          <CardHeader className="text-center pb-6">
            <div className="mx-auto h-16 w-16 rounded-2xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-lg mb-4">
              <svg
                className="h-8 w-8 text-primary-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
            <CardTitle className="text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text text-transparent mb-2">
              Welcome to OpenFork
            </CardTitle>
            <p className="text-muted-foreground text-lg">
              Distributed Computing Platform
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-center space-y-2">
              <p className="text-sm text-muted-foreground">
                Sign in to access your dashboard and manage distributed
                computing tasks
              </p>
            </div>
            <Button
              onClick={handleLogin}
              size="lg"
              className="w-full h-12 text-base font-medium bg-gradient-to-r from-[#4285F4] to-[#1967D2] hover:from-[#1967D2] hover:to-[#4285F4] text-white border-0 shadow-lg hover:shadow-xl transition-all duration-300 active:scale-[0.98]"
            >
              <svg
                className="w-5 h-5 mr-2"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Sign In with Google
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
