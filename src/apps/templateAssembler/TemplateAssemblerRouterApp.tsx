import { Navigate, Route, Routes } from "react-router-dom";
import TemplateAssemblerAssembliesPage from "./TemplateAssemblerAssembliesPage";
import TemplateAssemblerApp from "./TemplateAssemblerApp";

const LAST_ASSEMBLY_ID_KEY = "templateAssembler:lastAssemblyId";

function TemplateAssemblerIndexRedirect() {
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_ASSEMBLY_ID_KEY);
  } catch {
    // ignore
  }
  const cleaned = (last ?? "").trim();
  if (cleaned) return <Navigate to={`./edit/${encodeURIComponent(cleaned)}`} replace />;
  return <Navigate to="./assemblies" replace />;
}

export default function TemplateAssemblerRouterApp() {
  return (
    <Routes>
      <Route index element={<TemplateAssemblerIndexRedirect />} />
      <Route path="assemblies" element={<TemplateAssemblerAssembliesPage />} />
      <Route path="new" element={<TemplateAssemblerApp />} />
      <Route path="edit/:assemblyId" element={<TemplateAssemblerApp />} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}

