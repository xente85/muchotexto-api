/** Error con código HTTP y un mensaje seguro para mostrar al usuario. */
export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
