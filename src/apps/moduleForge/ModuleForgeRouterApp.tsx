import { Navigate, Route, Routes } from "react-router-dom";
import ModuleForgeLibraryPage from "./ModuleForgeLibraryPage";
import ModuleForgeEditorApp from "./ModuleForgeEditorApp";

const LAST_MODULE_FORGE_ID_KEY = "moduleForge:lastModuleId";

function ModuleForgeIndexRedirect() {
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_MODULE_FORGE_ID_KEY);
  } catch {
    // ignore
  }
  const cleaned = (last ?? "").trim();
  if (cleaned) return <Navigate to={`./edit/${encodeURIComponent(cleaned)}`} replace />;
  return <Navigate to="./library" replace />;
}

export default function ModuleForgeRouterApp() {
  return (
    <Routes>
      <Route index element={<ModuleForgeIndexRedirect />} />
      <Route path="library" element={<ModuleForgeLibraryPage />} />
      <Route path="new" element={<ModuleForgeEditorApp />} />
      <Route path="edit/:moduleId" element={<ModuleForgeEditorApp />} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}

