import {
  CWSimulateApp,
  GenericError,
  SimulateCosmWasmClient,
} from "@oraichain/cw-simulate";
import * as oraidexArtifacts from "@oraichain/oraidex-contracts-build";
import { Cw1IbcHooksClient } from "@oraichain/cw1hook-contracts-sdk";
import { deployContract } from "@oraichain/cw1hook-contracts-build";
import {
  Cw20Coin,
  OraiswapTokenClient,
  SigningCosmWasmClient,
} from "@oraichain/oraidex-contracts-sdk";
import { coins } from "@cosmjs/amino";
import { toBinary } from "@cosmjs/cosmwasm-stargate";
import * as crypto from "crypto";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";

const toDecimals = (num: number, decimals: number = 6): string => {
  return (num * 10 ** decimals).toFixed();
};

const senderAddress = "orai1g4h64yjt0fvzv5v2j8tyfnpe5kmnetejvfgs7g";
const initUsdtSenderAmount = "1000000000000";

const deployToken = async (
  client: SimulateCosmWasmClient,
  {
    symbol,
    name,
    decimals = 6,
    initial_balances = [
      { address: senderAddress, amount: initUsdtSenderAmount },
    ],
  }: {
    symbol: string;
    name: string;
    decimals?: number;
    initial_balances?: Cw20Coin[];
  }
): Promise<OraiswapTokenClient> => {
  const oraiSwapToken = await oraidexArtifacts.deployContract(
    client,
    senderAddress,
    {
      decimals,
      symbol,
      name,
      mint: { minter: senderAddress },
      initial_balances,
    },
    "oraiswap token",
    "oraiswap_token"
  );

  return new OraiswapTokenClient(
    client,
    senderAddress,
    oraiSwapToken.contractAddress
  );
};

const denomTrace = (port: string, channel: string, denom: string) => {
  return `ibc/${crypto
    .createHash("sha256")
    .update("transfer/channel-0/atom")
    .digest("hex")
    .toUpperCase()}`;
};

describe("cw1-ibc-hooks", () => {
  type UserWallet = {
    address: string;
    client: SigningCosmWasmClient;
  };

  const oraiClient = new SimulateCosmWasmClient({
    chainId: "Oraichain",
    bech32Prefix: "orai",
    metering: process.env.METERING === "true",
  });

  const cosmosChain = new CWSimulateApp({
    chainId: "cosmoshub-4",
    bech32Prefix: "cosmos",
  });

  let cw1Contract: Cw1IbcHooksClient;
  let usdtToken: OraiswapTokenClient;
  let sender: UserWallet;

  const cosmosAddress = "cosmos1ur2vsjrjarygawpdwtqteaazfchvw4fgf0kulf";

  const bobAddress = "orai18cgmaec32hgmd8ls8w44hjn25qzjwhannd9kpj";
  const aliceAddress = "orai1hz4kkphvt0smw4wd9uusuxjwkp604u7m4akyzv";
  const port = "transfer";
  const channel = "channel-0";
  const testCosmosDenom = "atom";
  const cosmosDenomTrace = denomTrace(port, channel, testCosmosDenom);
  const initialBalances = toDecimals(5000, 6);
  const transferAmount = "1000000";

  beforeEach(async () => {
    [senderAddress, aliceAddress].forEach((address) =>
      oraiClient.app.bank.setBalance(address, [
        { denom: "orai", amount: initialBalances },
      ])
    );
    sender = { client: oraiClient, address: senderAddress };

    const cw1ContractDeploy = await deployContract(
      oraiClient,
      senderAddress,
      "cw1-ibc-hooks"
    );
    cw1Contract = new Cw1IbcHooksClient(
      oraiClient,
      senderAddress,
      cw1ContractDeploy.contractAddress
    );
    console.log({ cw1: cw1Contract.contractAddress });
    usdtToken = await deployToken(oraiClient, {
      symbol: "USDT",
      name: "USDT token",
    });

    cosmosChain.bank.setBalance(
      cosmosAddress,
      coins(initialBalances, testCosmosDenom)
    );

    // relay message between Cosmos Hub and Oraichain
    cosmosChain.ibc.relay(channel, port, channel, port, oraiClient.app);

    // handle IBC message timeout
    oraiClient.app.ibc.addMiddleWare(async (ibcMsg, res) => {
      if (!ibcMsg.data.memo) return;
      const { wasm } = JSON.parse(ibcMsg.data.memo);
      const result = await oraiClient.app.wasm.executeContract(
        senderAddress,
        [],
        wasm.execute.contract_addr,
        wasm.execute.msg
      ); // WASM IBC Hooks
      console.dir(result, { depth: null });
      if (result.err) {
        console.log("ibc wasm hook err result: ", result);
      }
    });
  });

  it("test_instantiation", async () => {
    let balanceRes = await usdtToken.balance({ address: senderAddress });
    expect(balanceRes.balance).toBe(initUsdtSenderAmount);

    let aliceBalance = await usdtToken.balance({ address: aliceAddress });
    expect(aliceBalance.balance).toBe("0");

    let atomWallet = cosmosChain.bank.getBalance(cosmosAddress);
    expect(atomWallet).toEqual(coins(initialBalances, testCosmosDenom));
  });

  it("test_send_cw20_token", async () => {
    // fixture

    await usdtToken.transfer({
      amount: transferAmount,
      recipient: cw1Contract.contractAddress,
    });

    expect(
      (await usdtToken.balance({ address: cw1Contract.contractAddress }))
        .balance
    ).toEqual(transferAmount);

    // execute. mint ibc/orai on cosmos hub and burn orai on oraichain
    await cosmosChain.ibc.sendTransfer({
      channelId: "channel-0",
      receiver: cw1Contract.contractAddress,
      token: { amount: transferAmount, denom: testCosmosDenom },
      sender: cosmosAddress,
      timeout: {
        timestamp: "",
      },
      memo: JSON.stringify({
        wasm: {
          execute: {
            contract_addr: cw1Contract.contractAddress,
            msg: {
              execute_msgs: toBinary([
                {
                  wasm: {
                    execute: {
                      contract_addr: usdtToken.contractAddress,
                      msg: toBinary({
                        transfer: {
                          amount: transferAmount,
                          recipient: aliceAddress,
                        },
                      }),
                      funds: [],
                    },
                  },
                },
              ]),
            },
          },
        },
      }),
    });

    // assert
    const atomWallet = cosmosChain.bank.getBalance(cosmosAddress);
    expect(atomWallet).toEqual(coins("4999000000", testCosmosDenom));
    expect(oraiClient.app.bank.getBalance(cw1Contract.contractAddress)).toEqual(
      coins(transferAmount, cosmosDenomTrace)
    );

    const aliceBalance = await usdtToken.balance({ address: aliceAddress });
    console.log("alice balance: ", aliceBalance);
    console.log(
      "cw1 balance: ",
      (await usdtToken.balance({ address: cw1Contract.contractAddress }))
        .balance
    );
    expect(aliceBalance.balance).toBe(transferAmount);
  });

  it("test_transfer_native_token", async () => {
    // execute. mint ibc/orai on cosmos hub and burn orai on oraichain
    await cosmosChain.ibc.sendTransfer({
      channelId: "channel-0",
      receiver: cw1Contract.contractAddress,
      token: { amount: transferAmount, denom: testCosmosDenom },
      sender: cosmosAddress,
      timeout: {
        timestamp: "",
      },
      memo: JSON.stringify({
        wasm: {
          execute: {
            contract_addr: cw1Contract.contractAddress,
            msg: {
              execute_msgs: toBinary([
                {
                  bank: {
                    send: {
                      to_address: aliceAddress,
                      amount: [
                        {
                          denom: denomTrace(port, channel, testCosmosDenom),
                          amount: transferAmount,
                        },
                      ],
                    },
                  },
                },
              ]),
            },
          },
        },
      }),
    });

    // assert
    const atomWallet = cosmosChain.bank.getBalance(cosmosAddress);
    expect(atomWallet).toEqual(coins("4999000000", testCosmosDenom));
    const aliceBalance = oraiClient.app.bank.getBalance(aliceAddress);
    console.log("alice balance: ", aliceBalance);
    expect(
      aliceBalance.some(
        (coin) =>
          coin.denom === cosmosDenomTrace && coin.amount === transferAmount
      )
    ).toBe(true);
  });

  // test using stargate msg instead of existing msg
  it("test_transfer_native_token_stargate", async () => {
    // execute. mint ibc/orai on cosmos hub and burn orai on oraichain
    await cosmosChain.ibc.sendTransfer({
      channelId: "channel-0",
      receiver: cw1Contract.contractAddress,
      token: { amount: transferAmount, denom: testCosmosDenom },
      sender: cosmosAddress,
      timeout: {
        timestamp: "",
      },
      memo: JSON.stringify({
        wasm: {
          execute: {
            contract_addr: cw1Contract.contractAddress,
            msg: {
              execute_msgs: toBinary([
                {
                  stargate: {
                    type_url: "/cosmos.bank.v1beta1.MsgSend",
                    value: toBinary(
                      MsgSend.encode({
                        fromAddress: cw1Contract.contractAddress,
                        toAddress: aliceAddress,
                        amount: [
                          {
                            denom: denomTrace(port, channel, testCosmosDenom),
                            amount: transferAmount,
                          },
                        ],
                      }).finish()
                    ),
                  },
                },
              ]),
            },
          },
        },
      }),
    });

    // assert
    const atomWallet = cosmosChain.bank.getBalance(cosmosAddress);
    expect(atomWallet).toEqual(coins("4999000000", testCosmosDenom));
    // since stargate is not fully implemented in cw-simulate, as long as the ibc transfer doesnt fail then we're good to go
  });
});
