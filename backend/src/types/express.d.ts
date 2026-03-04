import { Request } from 'express';

declare global {
  namespace Express {
    interface Request {
      user?: any;
      file?: Express.Multer.File;
    }
  }
}

export { };
