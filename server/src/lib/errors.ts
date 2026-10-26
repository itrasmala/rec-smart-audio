export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code = "ERROR",
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, "BAD_REQUEST", details);
export const unauthorized = (msg = "يجب تسجيل الدخول") => new HttpError(401, msg, "UNAUTHORIZED");
export const forbidden = (msg = "ليست لديك صلاحية لتنفيذ هذه العملية") => new HttpError(403, msg, "FORBIDDEN");
export const notFound = (msg = "العنصر غير موجود") => new HttpError(404, msg, "NOT_FOUND");
export const conflict = (msg: string, details?: unknown) => new HttpError(409, msg, "CONFLICT", details);
