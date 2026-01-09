import { Home } from "lucide-react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { STUDIO_APPS } from "./appRegistry";

function SidebarIconLink({
  to,
  title,
  children,
  end,
}: {
  to: string;
  title: string;
  children: React.ReactNode;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={title}
      aria-label={title}
      className={({ isActive }) =>
        cn(
          "group relative h-11 w-11 rounded-xl border flex items-center justify-center transition-colors",
          "bg-background/80 backdrop-blur hover:bg-accent",
          isActive ? "border-primary text-primary" : "border-border text-muted-foreground",
        )
      }
    >
      {children}
      <span className="sr-only">{title}</span>
    </NavLink>
  );
}

export function StudioSidebar() {
  return (
    <aside className="w-16 shrink-0 border-r bg-muted/30 h-full flex flex-col items-center py-3 gap-3">
      <SidebarIconLink to="/" title="Home" end>
        <Home className="h-5 w-5" />
      </SidebarIconLink>

      <div className="w-8 h-px bg-border my-1" />

      <nav className="flex-1 flex flex-col items-center gap-3">
        {STUDIO_APPS.map((app) => {
          const Icon = app.icon;
          return (
            <SidebarIconLink key={app.id} to={app.navTo ?? app.route} title={app.title}>
              <Icon className="h-5 w-5" />
            </SidebarIconLink>
          );
        })}
      </nav>
    </aside>
  );
}

