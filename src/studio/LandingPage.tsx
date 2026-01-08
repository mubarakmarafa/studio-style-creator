import { Link } from "react-router-dom";
import { STUDIO_APPS } from "./appRegistry";

export function LandingPage() {
  return (
    <div className="h-full w-full overflow-auto">
      <div className="max-w-5xl mx-auto p-8">
        <div className="mb-8">
          <div className="text-xs text-muted-foreground">Content Studio</div>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">Apps</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Choose a tool to launch. The left sidebar is always available to switch apps.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STUDIO_APPS.map((app) => {
            const Icon = app.icon;
            return (
              <Link
                key={app.id}
                to={app.route}
                className="group border rounded-xl bg-card text-card-foreground hover:bg-accent transition-colors p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 min-w-10 shrink-0 rounded-lg border bg-background/80 flex items-center justify-center">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold">{app.title}</div>
                    <div className="text-sm text-muted-foreground mt-1">{app.description}</div>
                    <div className="text-xs text-muted-foreground mt-3 group-hover:text-foreground">
                      Open →
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

