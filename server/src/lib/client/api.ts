"use client";

let csrfToken = "";
export function setCsrfToken(t: string) {
  csrfToken = t;
}
export function getCsrfToken() {
  return csrfToken;
}

export type ApiError = { code: string; message: string; status: number };

export class ApiRequestError extends Error {
  constructor(public readonly error: ApiError) {
    super(error.message);
  }
}

/** JSON fetch with CSRF header and uniform error handling. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? "GET";
  const res = await fetch(path, {
    method,
    headers: {
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(method !== "GET" ? { "x-csrf-token": csrfToken } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) {
    const err = (data as { error?: { code: string; message: string } })?.error;
    if (res.status === 401 && err?.code === "AUTH_REQUIRED" && typeof window !== "undefined") window.location.href = "/login";
    throw new ApiRequestError({ code: err?.code ?? "PROCESSING_FAILED", message: err?.message ?? "Something went wrong.", status: res.status });
  }
  return data as T;
}

/** Raw-body upload with progress (fetch can't report upload progress). */
export function uploadWithProgress<T>(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (fraction: number) => void,
): { promise: Promise<T>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<T>((resolve, reject) => {
    xhr.open("POST", url);
    xhr.setRequestHeader("x-csrf-token", csrfToken);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-filename", encodeURIComponent(file.name));
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* empty */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else {
        const err = (data as { error?: ApiError })?.error;
        reject(new ApiRequestError({ code: err?.code ?? "PROCESSING_FAILED", message: err?.message ?? `Upload failed (${xhr.status}).`, status: xhr.status }));
      }
    };
    xhr.onerror = () => reject(new ApiRequestError({ code: "PROCESSING_FAILED", message: "Network error during upload.", status: 0 }));
    xhr.onabort = () => reject(new ApiRequestError({ code: "ABORTED", message: "Upload cancelled.", status: 0 }));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}
