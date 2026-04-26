import "dotenv/config";
import fs from "fs";
import path from "path";
import solc from "solc";
import { ethers } from "ethers";

const DEFAULT_RPC_URL = "http://185.8.107.85:9944";
const scriptDir = path.dirname(path.resolve(process.argv[1]));

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required in environment`);
  return v;
}

function normalizePrivateKey(pk: string): string {
  if (pk.startsWith("0x")) return pk;
  return `0x${pk}`;
}

function findImports(importPath: string): { contents?: string; error?: string } {
  const contractsPath = path.resolve(scriptDir, "..", "contracts", importPath);
  if (fs.existsSync(contractsPath)) {
    return { contents: fs.readFileSync(contractsPath, "utf8") };
  }
  const rootPath = path.resolve(scriptDir, "..", importPath);
  if (fs.existsSync(rootPath)) {
    return { contents: fs.readFileSync(rootPath, "utf8") };
  }
  const nmPath = path.resolve(scriptDir, "..", "node_modules", importPath);
  if (fs.existsSync(nmPath)) {
    return { contents: fs.readFileSync(nmPath, "utf8") };
  }
  return { error: `Import not found: ${importPath}` };
}

function compileTradingV7(): { abi: ethers.InterfaceAbi; bytecode: string } {
  const sourcePath = path.resolve(scriptDir, "..", "contracts", "TradingV7.sol");
  const source = fs.readFileSync(sourcePath, "utf8");

  const input = {
    language: "Solidity" as const,
    sources: {
      "TradingV7.sol": { content: source },
    },
    settings: {
      optimizer: { enabled: true, runs: 1 },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };

  type CompileOut = {
    contracts?: Record<string, Record<string, { abi: unknown; evm: { bytecode: { object: string } } }> >;
    errors?: Array<{ severity: string; sourceLocation?: { file: string; start: number }; formattedMessage?: string; message?: string }>;
  };
  const output = JSON.parse(
    solc.compile(JSON.stringify(input), { import: findImports })
  ) as CompileOut;

  if (output.errors?.length) {
    const fatal = output.errors.filter((e: { severity: string }) => e.severity === "error");
    output.errors.forEach((e: { severity: string; sourceLocation?: { file: string; start: number }; formattedMessage?: string; message?: string }) => {
      const loc = e.sourceLocation ? `${e.sourceLocation.file}:${e.sourceLocation.start}` : "";
      console.error(`${e.severity.toUpperCase()}: ${loc} ${e.formattedMessage ?? e.message}`);
    });
    if (fatal.length) throw new Error("Solidity compilation failed");
  }

  const contract = output.contracts?.["TradingV7.sol"]?.TradingV7;
  if (!contract) throw new Error("TradingV7 not found in compiler output");

  return {
    abi: contract.abi as ethers.InterfaceAbi,
    bytecode: `0x${contract.evm.bytecode.object}`,
  };
}

async function main(): Promise<void> {
  const rpcUrl = process.env.BITTENSOR_RPC_URL ?? DEFAULT_RPC_URL;
  const privateKey = normalizePrivateKey(requireEnv("KEY2"));

  console.log("RPC:", rpcUrl);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log("Deployer:", wallet.address);
  const bal = await provider.getBalance(wallet.address);
  console.log("Deployer balance:", ethers.formatEther(bal));

  const { abi, bytecode } = compileTradingV7();
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);

  console.log("Deploying TradingV7...");

  const txOverrides: { gasLimit: number; gasPrice?: bigint } = {
    gasLimit: process.env.GAS_LIMIT ? Number(process.env.GAS_LIMIT) : 5_000_000,
  };
  if (process.env.GAS_PRICE) {
    txOverrides.gasPrice = BigInt(process.env.GAS_PRICE);
  }

  const contract = await factory.deploy(txOverrides);
  const deployTx = contract.deploymentTransaction();
  if (deployTx) console.log("Deployment tx:", deployTx.hash);

  const receipt = await contract.deploymentTransaction()!.wait();
  const address = await contract.getAddress();
  console.log("Deployed at:", address);
  console.log("Block:", receipt!.blockNumber);

  const outDir = path.resolve(scriptDir, "..", "deployments");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

  const out = {
    network: "bittensor",
    address,
    deployer: wallet.address,
    txHash: deployTx!.hash,
    blockNumber: receipt!.blockNumber,
    deployedAt: new Date().toISOString(),
  };

  const outFile = path.resolve(outDir, "bittensor-TradingV7.json");
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log("Saved:", outFile);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
