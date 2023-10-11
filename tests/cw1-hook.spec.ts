import { CWSimulateApp, GenericError, SimulateCosmWasmClient } from "@oraichain/cw-simulate";
import * as oraidexArtifacts from '@oraichain/oraidex-contracts-build';
import {
  Cw1IbcHooksClient,
  Cw1IbcHooksTypes,
} from "@oraichain/cw1hook-contracts-sdk";
import { deployContract } from "@oraichain/cw1hook-contracts-build";
import {
  Cw20Coin,
  OraiswapTokenClient,
  OraiswapTokenTypes,
  SigningCosmWasmClient,
} from "@oraichain/oraidex-contracts-sdk";
import { coins } from "@cosmjs/amino";
import { toBinary } from '@cosmjs/cosmwasm-stargate';

const toDecimals = (num: number, decimals: number = 6): string => {
  return (num * 10 ** decimals).toFixed();
};

const senderAddress = "orai1g4h64yjt0fvzv5v2j8tyfnpe5kmnetejvfgs7g";

const deployToken = async (
  client: SimulateCosmWasmClient,
  {
    symbol,
    name,
    decimals = 6,
    initial_balances = [{ address: senderAddress, amount: "1000000000000" }],
  }: {
    symbol: string;
    name: string;
    decimals?: number;
    initial_balances?: Cw20Coin[];
  }
): Promise<OraiswapTokenClient> => {
  return new OraiswapTokenClient(
    client,
    senderAddress,
    await oraidexArtifacts
      .deployContract(
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
      )
      .then((res) => res.contractAddress)
  );
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
  const initialBalances = toDecimals(5000, 6);

  beforeEach(async () => {
    [senderAddress, aliceAddress, bobAddress].forEach((address) =>
      oraiClient.app.bank.setBalance(address, [
        { denom: "orai", amount: initialBalances },
      ])
    );
    sender = { client: oraiClient, address: senderAddress };

    cw1Contract = new Cw1IbcHooksClient(
      oraiClient,
      senderAddress,
      await deployContract(oraiClient, senderAddress, "cw1-ibc-hooks").then(
        (res) => res.contractAddress
      )
    );
    console.log({ cw1: cw1Contract.contractAddress});
    usdtToken = await deployToken(oraiClient, {
      symbol: "USDT",
      name: "USDT token",
    });

    cosmosChain.bank.setBalance(cosmosAddress, coins(initialBalances, "atom"));
    
    // relay message between Cosmos Hub and Oraichain
    cosmosChain.ibc.relay(
      "channel-0",
      "transfer",
      "channel-0",
      "transfer",
      oraiClient.app
    );

    // handle IBC message timeout
    oraiClient.app.ibc.addMiddleWare(async (ibcMsg, res) => {
      console.log({ ibcMsg });
      const { wasm } = JSON.parse(ibcMsg.data.memo);
      await oraiClient.app.wasm.executeContract(
        senderAddress,
        [],
        wasm.contract,
        wasm.msg
      ); // WASM IBC Hooks
    });
  });

  it("test_instantiation", async () => {
    let balanceRes = await usdtToken.balance({ address: senderAddress });
    expect(balanceRes.balance).toBe("1000000000000");
  });

  it("test_transfer_token", async () => {
    let aliceBalance = await usdtToken.balance({address: aliceAddress});
    expect(aliceBalance.balance).toBe("0");

    let atomWallet = cosmosChain.bank.getBalance(cosmosAddress);
    expect(atomWallet).toEqual(coins(initialBalances, "atom"));

    // mint ibc/orai on cosmos hub and burn orai on oraichain
    await cosmosChain.ibc.sendTransfer({
      channelId: "channel-0",
      receiver: senderAddress,
      token: { amount: "1000000", denom: "atom" },
      sender: cosmosAddress,
      timeout: {
        timestamp: "",
      },
      memo: JSON.stringify({
        wasm: {
          contract: usdtToken.contractAddress,
          msg: {
            transfer: {
              amount: "1000000",
              recipient: aliceAddress,
            },
          },
        },
      }),
    });

    atomWallet = cosmosChain.bank.getBalance(cosmosAddress);
    expect(atomWallet).toEqual(coins("4999000000", "atom"));

    aliceBalance = await usdtToken.balance({address: aliceAddress});
    expect(aliceBalance.balance).toBe("1000000");
  });

  it("test_transfer_token_through_hook", async () => {
    let aliceBalance = await usdtToken.balance({address: aliceAddress});
    expect(aliceBalance.balance).toBe("0");

    let atomWallet = cosmosChain.bank.getBalance(cosmosAddress);
    expect(atomWallet).toEqual(coins(initialBalances, "atom"));

    let transferMsg = toBinary({
      transfer: {
        amount: "1000000",
        recipient: aliceAddress,
      },
    } as OraiswapTokenTypes.ExecuteMsg)

    let hookMsg = toBinary({
      execute: {
        msg: transferMsg,
      },
    } as Cw1IbcHooksTypes.ExecuteMsg)
    // mint ibc/orai on cosmos hub and burn orai on oraichain
    await cosmosChain.ibc.sendTransfer({
      channelId: "channel-0",
      receiver: senderAddress,
      token: { amount: "1000000", denom: "atom" },
      sender: cosmosAddress,
      timeout: {
        timestamp: "",
      },
      memo: JSON.stringify({
        wasm: {
          contract: cw1Contract.contractAddress,
          msg: hookMsg,
        },
      }),
    });

    atomWallet = cosmosChain.bank.getBalance(cosmosAddress);
    expect(atomWallet).toEqual(coins("4999000000", "atom"));

    aliceBalance = await usdtToken.balance({address: aliceAddress});
    expect(aliceBalance.balance).toBe("1000000");
  }); 
});
