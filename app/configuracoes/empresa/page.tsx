import { redirect } from "next/navigation";

export const metadata = {
  title: "Empresa",
};

export default function EmpresaIdentidadeRedirectPage() {
  redirect("/configuracoes/fiscal/empresa");
}
