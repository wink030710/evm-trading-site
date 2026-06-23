import { ethers } from "ethers";
import { MaxUint256, parseUnits } from "ethers";
import "dotenv/config";

const CONTRACT_ADDRESS = "0x96687204A2Ced68A5A1Ddc1388748617F6eE5c9f";
const CONTRACT_ADDRESS_2 = "0xE90dF3629dfB8bfd7E3d17063058f9EBe0639c8F";

const ABI = [
  "function owner() view returns (address)",

  // Stake operations (TAO <-> root)
  "function addStakeToRoot(uint256 amount) external",
  "function addStakeToRootFull() external",
  "function removeStakeFromRoot(uint256 amount) external",
  "function removeStakeFromRootFull() external",

  // Limit-price stake operations
  "function addStakeLimits(uint256[] netuids, uint256[] amounts, uint256[] limitPrices) external",
  "function removeStakeLimits(uint256[] netuids, uint256[] limitPrices) external",

  // MEV-aware stake operations
  "function mevAddStakes(uint256[] netuids, uint256[] amounts, bytes32[] mevHotkeyBytesKeys, bytes32[] mevColdkeyBytesKeys, uint256[] minAlphas, bool isMineStaked) external",
  "function mevRemoveStakes(uint256[] netuids, bytes32[] mevHotkeyBytesKeys, bytes32[] mevColdkeyBytesKeys, uint256[] minAlphas) external",

  // Admin / config
  "function setStakedPrices(uint256[] netuids, uint256[] prices) external",
  "function updateContractBytesKey(bytes32 newContractBytesKey) external",
  "function updateMevAddresses(address[] newMevAddresses) external",
  "function setWithdrawer(address newWithdrawer) external",
  "function setConfig(address newWithdrawer, bytes32 newDelegatorColdkey) external",
  "function moveStakeAll(bytes32 destinationColdkey) external",

  // Rock (panic lock)
  "function setRock() external",
  "function unRock() external",

  // Withdraws
  "function withdrawAll(address to) external",
  "function withdrawSmall(address to, uint256 amount) external",
  "function withdrawFee(uint256 amount) external",
  "function withdrawBig(address to, uint256 amount) external",

  // Public state getters
  "function contractBytesKey() view returns (bytes32)",
  "function withdrawer() view returns (address)",
  "function lastLimitPrices(uint256) view returns (uint256)",
  "function mevAddresses(uint256) view returns (address)",
  "function lastWithdrawSmallTime() view returns (uint256)",
  "function rocked() view returns (bool)",
  "function DELEGATOR_HOTKEY() view returns (bytes32)",
  "function DELEGATOR_COLDKEY() view returns (bytes32)",

  // View helpers
  "function getAlphaPrices() view returns (uint256[129] alphaPrices)",
  "function getTaoInPools() view returns (uint64[129] taoInPools)",
  "function getAlphaInPools() view returns (uint64[129] alphaInPools)",
  "function getStakedAmounts(bytes32[] hotkeys, bytes32[] coldkeys) view returns (uint256[129] amounts)",
  "function getMevStakedAmounts(uint256[] netuids, bytes32[] mevHotkeyBytesKeys, bytes32[] mevColdkeyBytesKeys) view returns (uint256[] amounts)",
  // "function getTradingInfo(bytes32[] _mevHotkeyBytesKeys, bytes32[] _mevColdkeyBytesKeys, uint256 hotkey_cnt) view returns (uint256[129] alphaPrices, uint64[129] taoInPools, uint64[129] alphaInPools, uint256[129] _stakedPrices, uint256[129] stakedAmounts, uint256[][] init_alphas, uint256 freeBalance, uint256 ownerBalance, uint256[] int_taos)",
  "function getTradingInfo(bytes32[] _mevColdkeyBytesKeys) view returns (uint256[129] alphaPrices, uint64[129] taoInPools, uint64[129] alphaInPools, uint256[129] _stakedPrices, uint256[129] stakedAmounts, uint256 freeBalance, uint256 ownerBalance, uint256[] init_taos)",

  // Custom errors (for nicer revert decoding)
  "error AmountZero()",
  "error TransferFailed()",
  "error FunctionNotFound()",
  "error NotWithdrawer()",
  "error InvalidAddress()",
  "error InvalidBytesKey()",
  "error ArrayLengthMismatch()",
  "error AmountTooLarge()",
  "error WithdrawTooSoon()",
  "error OutsideWithdrawWindow()",
  "error Rocked()",
  "error NotOwner()",
  "error NotOwnerOrWithdrawer()",
];

async function main(): Promise<void> {
  try {
    const provider = new ethers.JsonRpcProvider("http://185.8.107.85:9944");

    // const privateKey = process.env.PRIVATE_KEY;
    const privateKey = process.env.KEY2;
    if (!privateKey)
      throw new Error("PRIVATE_KEY not found in environment variables");

    const signer = new ethers.Wallet(privateKey, provider);
    console.log("Using account:", signer.address);

    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
    const contract2 = new ethers.Contract(CONTRACT_ADDRESS_2, ABI, signer);

    const balance = await provider.getBalance(CONTRACT_ADDRESS);
    console.log("\nContract balance:", ethers.formatEther(balance), "TAO");

    // const tx = await contract2.addStakeLimits([64], [ethers.parseUnits("3.7833063", 9)], [MaxUint256]);
    // const tx = await contract2.removeStakeLimits([0], [0]);
    // const tx = await contract2.addStakeToRootFull();
    // const tx = await contract.addStakeToRoot(ethers.parseUnits("24.0", 9));
    // const tx = await contract2.setConfig("0x96687204A2Ced68A5A1Ddc1388748617F6eE5c9f", "0xc8697ddec4d7d2dd6750e51bd557e208d15651b826656d7260b08e8e9f5d2755");
    const tx = await contract.removeStakeFromRootFull();
    // const tx = await contract.removeStakeFromRoot(parseUnits("0.9", 9));
    // const old = await contract2.getTradingInfo([]);
    // let list = [], _stakedPrices = [];
    // for (let i = 0; i < 129; i ++) {
    //   list.push(i);
    //   _stakedPrices.push(old._stakedPrices[i]);
    // }
    // const tx = await contract.setStakedPrices(list, _stakedPrices);
    // const tx = await contract.setRock();
    // const tx = await contract.unRock();
    // const tx = await contract.setWithdrawer("0x024326Bf8D2db920fa20e56A89bc102aeCCeD4eC");
    // const tx = await contract2.moveStakeAll("0x5bc73267f9990b1554109dc41e624a7dab56b1128f1ef2f62f6314294c038f9d");
    // const tx = await contract.removeStakeLimits([21,34], [0,0]);
    // const tx = await contract.withdrawFee(
    //   ethers.parseEther("1.5")
    // );
    // const tx = await contract.withdrawBig(
    //   "0xe2fc9873166079715d80375ecd52d545cb284fdb",
    //   ethers.parseEther("0.2")
    // );
    // const tx = await contract.withdrawSmall(
    //   "0xe2fc9873166079715d80375ecd52d545cb284fdb",
    //   ethers.parseEther("1.5")
    // );
    // const tx = await contract2.withdrawAll(
    //   "0xe2fc9873166079715D80375ECd52d545Cb284FDb"
    // );
    // const newContractBalance = await provider.getBalance(CONTRACT_ADDRESS);
    // const newOwnerBalance = await provider.getBalance(signer.address);
    // console.log("\nFinal balances:");
    // console.log(
    //   "Contract balance:",
    //   ethers.formatEther(newContractBalance),
    //   "TAO",
    // );
    // console.log("Owner balance:", ethers.formatEther(newOwnerBalance), "TAO");
    // return;
    const tradingInfo = await contract.getTradingInfo(
      [
        "0x284939bf14aa84df2e9b5300d3360583df1d4db39dc3f2201f6aaa2ae434d76a",
        "0xcdb33a56c3a1c25126ec5082075bc811eed793bf796d8f31fb37038e63f84f00",
        "0xa2afbf8617d7fb092a2a20f7fc82e9738a5431d2ae235b0c3d3efef9bec51402",
      ]
    );
    const notStakedNetuids: number[] = [];
    const blacklistedNetuids: number[] = [
      3, 8, 12, 29, 39, 104, 16, 92, 4, 9, 17, 19, 44, 51, 56, 62, 64, 68,
      120,
    ];
    for (let i = 1; i < 129; i++) {
      if (blacklistedNetuids.includes(i)) continue;
      let alphaPrice = Number(tradingInfo.alphaPrices[i]);
      let limitPrice = Number(tradingInfo._stakedPrices[i]);
      if (limitPrice == 0) ((limitPrice = 1), (alphaPrice = 1));
      const percentChange = ((alphaPrice - limitPrice) * 100) / limitPrice;
      const isStaked = (tradingInfo.stakedAmounts[i] as bigint) > 0n;
      if (!isStaked) {
        console.log(
          `Netuid\t${i}\t${percentChange.toFixed(2)}%\t\t${isStaked ? "T" : "F"}`,
        );
        notStakedNetuids.push(i);
      }
    }
    console.log(
      "Not staked netuids:",
      notStakedNetuids,
      `Total: ${notStakedNetuids.length}`,
    );
  } catch (error) {
    const err = error as Error;
    console.error("\nError occurred:");
    const msg = err.message ?? "";
    if (msg.includes("AmountZero")) {
      console.error("Amount is zero (contract balance or input was 0)");
    } else if (msg.includes("AmountTooLarge")) {
      console.error("Amount exceeds WITHDRAW_SMALL_MAX_AMOUNT");
    } else if (msg.includes("WithdrawTooSoon")) {
      console.error("withdrawSmall cooldown has not elapsed yet");
    } else if (msg.includes("OutsideWithdrawWindow")) {
      console.error("Outside the 14:00-16:00 UTC withdraw window");
    } else if (msg.includes("Rocked")) {
      console.error("Contract is rocked (panic-locked); call unRock first");
    } else if (msg.includes("NotWithdrawer")) {
      console.error("Caller is not the withdrawer");
    } else if (msg.includes("NotOwnerOrWithdrawer")) {
      console.error("Caller is neither the owner nor the withdrawer");
    } else if (msg.includes("NotOwner")) {
      console.error("Caller is not the owner");
    } else if (msg.includes("InvalidAddress")) {
      console.error("Invalid address argument (zero address?)");
    } else if (msg.includes("InvalidBytesKey")) {
      console.error("Invalid bytes32 key argument (zero bytes?)");
    } else if (msg.includes("ArrayLengthMismatch")) {
      console.error("Input array lengths do not match");
    } else if (msg.includes("TransferFailed")) {
      console.error("ETH transfer to recipient failed");
    } else if (msg.includes("FunctionNotFound")) {
      console.error("Fallback hit: function selector not found");
    } else if (msg.includes("insufficient funds")) {
      console.error("Insufficient funds for gas");
    } else {
      console.error(msg);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
