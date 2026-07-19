export class ServiceError extends Error {
  constructor(
    readonly statusCode: 400 | 401 | 403 | 404 | 409 | 410 | 422 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}
