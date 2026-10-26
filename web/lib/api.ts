export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Body = Record<string, unknown> | unknown[] | FormData | undefined;

async function request<T>(method: string, url: string, body?: Body): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body && !isForm ? { "content-type": "application/json" } : undefined,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "تعذّر الاتصال بالخادم — تحقق من الشبكة");
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth/")) {
      window.dispatchEvent(new CustomEvent("rec:unauthorized"));
    }
    throw new ApiError(res.status, json?.error?.message ?? `HTTP ${res.status}`, json?.error?.code, json?.error?.details);
  }
  return json as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: Body) => request<T>("POST", url, body ?? {}),
  put: <T>(url: string, body?: Body) => request<T>("PUT", url, body ?? {}),
  patch: <T>(url: string, body?: Body) => request<T>("PATCH", url, body ?? {}),
  del: <T>(url: string) => request<T>("DELETE", url),
};

/** Upload with progress (fetch has no upload progress). */
export function uploadWithProgress<T>(url: string, form: FormData, onProgress: (pct: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let json: any = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(json as T);
      else reject(new ApiError(xhr.status, json?.error?.message ?? `HTTP ${xhr.status}`, json?.error?.code));
    };
    xhr.onerror = () => reject(new ApiError(0, "تعذّر رفع الملف — تحقق من الاتصال"));
    xhr.send(form);
  });
}
