import { parseEther, parseUnits } from "ethers/lib/utils";
import hre from "hardhat";
import {
  CORE_ADDRESS,
  ETH_TOKEN_ADDRESS,
  USDC_ADDRESS,
  WETH_ADDRESS,
} from "../constants";
import { PortfolioDCA, IERC20 } from "../typechain";

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const chainId = 137;

  const DCA_CORE_ADDRESS = CORE_ADDRESS[chainId];
  const TOKEN_IN_ADDRESS = ETH_TOKEN_ADDRESS;
  const TOKEN_OUT_ADDRESS = "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619";
  const TOKEN_IN_WEIGHT = 10000
  const TREASURY_IN = parseEther("1");
  const AMOUNT_IN = parseEther("1");
  const AMOUNT_DCA = parseEther("0.25");
  const INTERVAL = 900;

  const portfolioDCA = <PortfolioDCA>(
    await hre.ethers.getContractAt("PortfolioDCA", DCA_CORE_ADDRESS)
  );
  const slippage = await portfolioDCA.minSlippage();

  // const usdc = <IERC20>await hre.ethers.getContractAt("IERC20", TOKEN_IN_ADDRESS);
  // const txApprove = await usdc
  //   .connect(signer)
  //   .approve(portfolioDCA.address, hre.ethers.constants.MaxUint256);
  // console.log(txApprove.hash);
  // await txApprove.wait();

  const tx = await portfolioDCA
    .connect(signer)
    .setPosition(
      TREASURY_IN,
      TOKEN_IN_ADDRESS,
      [TOKEN_OUT_ADDRESS],
      [TOKEN_IN_WEIGHT],
      0,
      AMOUNT_DCA,
      INTERVAL,
      [slippage],
      100,
      {
        value: AMOUNT_IN,
      }
    );
  console.log(tx.hash);
  await tx.wait();

  console.log("CONFIRMED");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
