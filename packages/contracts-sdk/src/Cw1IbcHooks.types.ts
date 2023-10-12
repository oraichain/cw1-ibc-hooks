import {} from "./types.js";
export interface InstantiateMsg {}
export type ExecuteMsg = {
  execute: {
    msg: Binary;
  };
};
export type Binary = string;
export type QueryMsg = string;