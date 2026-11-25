import type { SVGProps } from "react";

function make(d: string | string[]) {
  return function Icon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden width="1em" height="1em" {...props}>
        {(Array.isArray(d) ? d : [d]).map((p, i) => (
          <path key={i} d={p} />
        ))}
      </svg>
    );
  };
}

export const IconDownload = make(["M12 3v12", "m7 10 5 5 5-5", "M5 21h14"]);
export const IconLink = make(["M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5", "M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"]);
export const IconClipboard = make(["M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1Z", "M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"]);
export const IconHistory = make(["M3 12a9 9 0 1 0 3-6.7L3 8", "M3 3v5h5", "M12 7v5l3 2"]);
export const IconArchive = make(["M3 5h18v4H3z", "M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9", "M10 13h4"]);
export const IconUser = make(["M20 21a8 8 0 0 0-16 0", "M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"]);
export const IconSettings = make([
  "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z",
]);
export const IconHome = make(["m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1Z"]);
export const IconSun = make(["M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z", "M12 1v2", "M12 21v2", "m4.2 4.2 1.4 1.4", "m18.4 18.4 1.4 1.4", "M1 12h2", "M21 12h2", "m4.2 19.8 1.4-1.4", "m18.4 5.6 1.4-1.4"]);
export const IconMoon = make(["M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"]);
export const IconMonitor = make(["M3 4h18v12H3z", "M8 20h8", "M12 16v4"]);
export const IconTrash = make(["M3 6h18", "M8 6V4h8v2", "M19 6l-1 14H6L5 6"]);
export const IconImage = make(["M3 5h18v14H3z", "m3 16 5-5 4 4 3-3 6 6", "M15.5 9.5a1 1 0 1 0 0-.01"]);
export const IconVideo = make(["M3 6h13v12H3z", "m16 10 5-3v10l-5-3"]);
export const IconLayers = make(["m12 3 9 5-9 5-9-5 9-5Z", "m3 13 9 5 9-5"]);
export const IconFilm = make(["M4 3h16v18H4z", "M8 3v18", "M16 3v18", "M4 8h4", "M4 16h4", "M16 8h4", "M16 16h4"]);
export const IconUpload = make(["M12 21V9", "m7 14 5-5 5 5", "M5 3h14"]);
export const IconShield = make(["M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z", "m9 12 2 2 4-4"]);
export const IconLogout = make(["M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4", "M10 17l-5-5 5-5", "M5 12h11"]);
export const IconX = make(["M6 6l12 12", "M18 6 6 18"]);
export const IconCheck = make(["m5 12 5 5 9-10"]);
export const IconExternal = make(["M14 4h6v6", "M20 4 10 14", "M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"]);
export const IconPlug = make(["M9 2v6", "M15 2v6", "M6 8h12v3a6 6 0 0 1-12 0Z", "M12 17v5"]);
export const IconChevronLeft = make(["m15 18-6-6 6-6"]);
export const IconChevronRight = make(["m9 18 6-6-6-6"]);
