export class AppError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) {
    super(message);
  }
}

export function errorBody(error: AppError) {
  return { error: { code: error.code, message: error.message } };
}
