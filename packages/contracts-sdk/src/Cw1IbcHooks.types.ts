import {} from "./types";
export interface InstantiateMsg {}
export type ExecuteMsg = {
  execute_msgs: Binary;
};
export type Binary = string;
export type QueryMsg = string;