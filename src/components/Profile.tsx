import { useClientStore } from "@/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";

export function Profile() {
  const { session } = useClientStore();

  if (!session) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>User Profile</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <h3 className="font-medium">Email</h3>
            <p className="text-gray-500 text-gray-400">{session.user.email}</p>
          </div>
          <div>
            <h3 className="font-medium">User ID</h3>
            <p className="text-gray-500 text-gray-400">{session.user.id}</p>
          </div>
          {/* Add more profile information here as needed */}
        </div>
      </CardContent>
    </Card>
  );
}
