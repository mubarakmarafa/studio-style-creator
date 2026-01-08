import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="h-full w-full flex items-center justify-center p-8">
      <div className="max-w-md w-full border rounded-xl bg-card text-card-foreground p-6">
        <div className="text-sm text-muted-foreground">404</div>
        <h1 className="text-xl font-semibold mt-1">Page not found</h1>
        <p className="text-sm text-muted-foreground mt-2">
          That route doesn’t exist. Use Home to return to the app launcher.
        </p>
        <Link to="/" className="inline-block mt-4 text-sm text-primary hover:underline">
          Go to Home
        </Link>
      </div>
    </div>
  );
}

