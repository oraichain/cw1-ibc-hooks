import {
  InstantiateResult,
  SigningCosmWasmClient,
  UploadResult,
} from "@cosmjs/cosmwasm-stargate";
import {
  Cw1IbcHooksTypes
} from "@oraichain/cw1hook-contracts-sdk";
import { readFileSync } from "fs";
import path from "path";

export type InstantiateMsg = Cw1IbcHooksTypes.InstantiateMsg;

const contractDir = path.join(path.dirname(module.filename), "..", "data");

export const getContractDir = (name: "cw1-ibc-hooks") => {
  return path.join(contractDir, name + ".wasm");
};

export const deployContract = async (
  client: SigningCosmWasmClient,
  senderAddress: string,
  msg?: InstantiateMsg,
  label?: string
): Promise<UploadResult & InstantiateResult> => {
  // upload and instantiate the contract
  const initMsg: InstantiateMsg = {};
  const wasmBytecode = readFileSync(getContractDir("cw1-ibc-hooks"));
  const uploadRes = await client.upload(senderAddress, wasmBytecode, "auto");
  const initRes = await client.instantiate(
    senderAddress,
    uploadRes.codeId,
    initMsg,
    label ?? "cw1-ibc-hooks",
    "auto"
  );
  return { ...uploadRes, ...initRes };
};
