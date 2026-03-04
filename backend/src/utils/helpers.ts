import { Request } from 'express';

export const getSortObject = (sort: any): string => {
  if (typeof sort === 'string') {
    return sort;
  }
  return '-createdAt'; // default sort
};

export const getStringParam = (param: any): string | undefined => {
  if (typeof param === 'string') {
    return param;
  }
  return undefined;
};

export const getNumberParam = (param: any, defaultValue: number = 1): number => {
  if (typeof param === 'string') {
    const num = parseInt(param);
    return isNaN(num) ? defaultValue : num;
  }
  return defaultValue;
};
