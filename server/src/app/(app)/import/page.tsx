import { ImportPage } from "@/components/ImportPage";
import { getConfig } from "@/lib/config";

export const metadata = { title: "Import" };

export default function Page() {
  const l = getConfig().limits;
  return <ImportPage maxArchiveMb={Math.floor(l.maxArchiveUploadBytes / 1048576)} maxUploadMb={Math.floor(l.maxUploadBytes / 1048576)} />;
}
