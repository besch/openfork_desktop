import { useClientStore } from "@/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function Profile() {
  const { session } = useClientStore();

  if (!session) {
    return null;
  }

  return (
    <Card className="bg-card/50 backdrop-blur-sm border-white/10">
      <CardHeader>
        <CardTitle>User Profile</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <h3 className="font-medium">Email</h3>
            <p className="text-muted-foreground">{session.user.email}</p>
          </div>
          <div>
            <h3 className="font-medium">User ID</h3>
            <p className="text-muted-foreground">{session.user.id}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
