import { Navigate, Route, Routes } from "react-router-dom";
import StyleBuilderProjectsPage from "./StyleBuilderProjectsPage";
import StyleBuilderEditorApp from "./StyleBuilderApp";

const LAST_STYLE_BUILDER_PROJECT_ID_KEY = "styleBuilder:lastProjectId";

function StyleBuilderIndexRedirect() {
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_STYLE_BUILDER_PROJECT_ID_KEY);
  } catch {
    // ignore
  }
  const cleaned = (last ?? "").trim();
  if (cleaned) return <Navigate to={`./${encodeURIComponent(cleaned)}`} replace />;
  return <Navigate to="./projects" replace />;
}

export default function StyleBuilderRouterApp() {
  return (
    <Routes>
      <Route index element={<StyleBuilderIndexRedirect />} />
      <Route path="projects" element={<StyleBuilderProjectsPage />} />
      <Route path=":projectId" element={<StyleBuilderEditorApp />} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}

