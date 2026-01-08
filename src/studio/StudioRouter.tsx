import { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { StudioLayout } from "./StudioLayout";
import { LandingPage } from "./LandingPage";
import { NotFoundPage } from "./NotFoundPage";
import { STUDIO_APPS } from "./appRegistry";

const lazyApps = STUDIO_APPS.map((app) => ({
  ...app,
  Component: lazy(app.loader),
}));

function LoadingScreen() {
  return (
    <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground">
      Loading…
    </div>
  );
}

export function StudioRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<StudioLayout />}>
          <Route index element={<LandingPage />} />

          {lazyApps.map(({ id, route, Component }) => (
            <Route
              key={id}
              path={route}
              element={
                <Suspense fallback={<LoadingScreen />}>
                  <Component />
                </Suspense>
              }
            />
          ))}

          <Route path="/home" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

