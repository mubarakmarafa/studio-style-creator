import { Outlet } from "react-router-dom";
import { StudioSidebar } from "./StudioSidebar";

export function StudioLayout() {
  return (
    <div className="h-screen w-screen flex overflow-hidden bg-background text-foreground">
      <StudioSidebar />
      <main className="flex-1 min-w-0 min-h-0 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}

