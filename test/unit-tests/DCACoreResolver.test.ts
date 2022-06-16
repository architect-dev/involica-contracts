import { ethers } from "hardhat";
import {
  PortfolioDCA,
  PortfolioDCAResolver,
  PortfolioDCAResolver__factory,
  PortfolioDCA__factory,
  IERC20,
} from "../../typechain";

import chai from "chai";
import { solidity } from "ethereum-waffle";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  ROUTER_ADDRESS,
  USDC_ADDRESS,
  USDC_DECIMALS,
  WETH_ADDRESS,
} from "../../constants";
import { BigNumber, BigNumberish } from "@ethersproject/bignumber";
import {
  fastForwardTo,
  getCurrentTimestamp,
  mintUsdc,
} from "../helpers/utils";
import { parseUnits } from "@ethersproject/units";
import { Contract } from "ethers/lib/ethers";

const { expect } = chai;
chai.use(solidity);

// describe("PortfolioDCAResolver", function () {
//   let deployer: SignerWithAddress;
//   let alice: SignerWithAddress;
//   let bob: SignerWithAddress;
//   let deployerAddress: string;
//   let aliceAddress: string;
//   let bobAddress: string;

//   let portfolioDCA: PortfolioDCA;
//   let resolver: PortfolioDCAResolver;
//   let uniRouter: Contract;

//   let usdc: IERC20;
//   let weth: IERC20;

//   let defaultFund: BigNumber;
//   let defaultDCA: BigNumber;
//   let defaultInterval: BigNumberish;
//   let defaultSwapPath: string[];
//   let defaultSlippage: BigNumber;

//   let snapshotId: string;
//   const chainId = 1;

//   before("setup contracts", async () => {
//     [deployer, alice, bob] = await ethers.getSigners();
//     deployerAddress = deployer.address;
//     aliceAddress = alice.address;
//     bobAddress = bob.address;

//     usdc = <IERC20>await ethers.getContractAt("IERC20", USDC_ADDRESS[chainId]);
//     weth = <IERC20>await ethers.getContractAt("IERC20", WETH_ADDRESS[chainId]);

//     defaultFund = parseUnits("10000", USDC_DECIMALS);
//     defaultDCA = defaultFund.div(10);
//     defaultInterval = 60; // second;
//     defaultSwapPath = [USDC_ADDRESS[chainId], weth.address];

//     const PortfolioDCAFactory = (await ethers.getContractFactory(
//       "PortfolioDCA",
//       deployer
//     )) as PortfolioDCA__factory;
//     portfolioDCA = await PortfolioDCAFactory.deploy(
//       ROUTER_ADDRESS[chainId],
//       deployerAddress,
//       weth.address
//     );
//     await portfolioDCA.deployed();
//     defaultSlippage = await portfolioDCA.minSlippage();

//     const PortfolioDCAResolverFactory = (await ethers.getContractFactory(
//       "PortfolioDCAResolver",
//       deployer
//     )) as PortfolioDCAResolver__factory;
//     resolver = await PortfolioDCAResolverFactory.deploy(
//       portfolioDCA.address,
//       ROUTER_ADDRESS[chainId]
//     );
//     await resolver.deployed();

//     uniRouter = await ethers.getContractAt(
//       "IUniswapV2Router",
//       ROUTER_ADDRESS[chainId]
//     );

//     await portfolioDCA
//       .connect(deployer)
//       .setAllowedTokenPair(usdc.address, weth.address, true);

//     await mintUsdc(defaultFund.mul(10), aliceAddress);
//     await mintUsdc(defaultFund.mul(10), bobAddress);

//     await usdc
//       .connect(alice)
//       .approve(portfolioDCA.address, ethers.constants.MaxUint256);
//     await usdc
//       .connect(bob)
//       .approve(portfolioDCA.address, ethers.constants.MaxUint256);

//     snapshotId = await ethers.provider.send("evm_snapshot", []);
//   });

//   beforeEach(async () => {
//     await ethers.provider.send("evm_revert", [snapshotId]);
//     snapshotId = await ethers.provider.send("evm_snapshot", []);
//   });

//   describe("getExecutablePositions()", async () => {
//     it("should return false if no executable positions", async () => {
//       const [canExec, payload] = await resolver.getExecutablePositions();
//       expect(canExec).to.be.eq(false);

//       const taskData = portfolioDCA.interface.encodeFunctionData("executeDCAs", [
//         [],
//         [],
//       ]);
//       expect(payload).to.be.eq(taskData);
//     });
//     it("should return true if there is an executable position", async () => {
//       const positionId = await getNextPositionId(portfolioDCA);
//       await portfolioDCA
//         .connect(alice)
//         .setPosition(
//           usdc.address,
//           weth.address,
//           defaultFund,
//           defaultDCA,
//           defaultInterval,
//           defaultSlippage
//         );

//       const [canExec, payload] = await resolver.getExecutablePositions();
//       expect(canExec).to.be.eq(true);

//       const amounts = await uniRouter.getAmountsOut(
//         defaultDCA,
//         defaultSwapPath
//       );
//       const amountOutMin: BigNumber = amounts[1];
//       const taskData = portfolioDCA.interface.encodeFunctionData("executeDCAs", [
//         [positionId],
//         [{ swapAmountOutMin: amountOutMin, swapPath: defaultSwapPath }],
//       ]);
//       expect(payload).to.be.eq(taskData);
//     });
//     it("should return true if there are executable positions", async () => {
//       const positionId1 = await getNextPositionId(portfolioDCA);
//       await portfolioDCA
//         .connect(alice)
//         .setPosition(
//           usdc.address,
//           weth.address,
//           defaultFund,
//           defaultDCA,
//           defaultInterval,
//           defaultSlippage
//         );

//       const positionId2 = await getNextPositionId(portfolioDCA);
//       await portfolioDCA
//         .connect(bob)
//         .setPosition(
//           usdc.address,
//           weth.address,
//           defaultFund,
//           defaultDCA.mul(2),
//           defaultInterval,
//           defaultSlippage
//         );

//       const [canExec, payload] = await resolver.getExecutablePositions();
//       expect(canExec).to.be.eq(true);

//       const amounts1 = await uniRouter.getAmountsOut(
//         defaultDCA,
//         defaultSwapPath
//       );
//       const amountOutMin1: BigNumber = amounts1[1];
//       const amounts2 = await uniRouter.getAmountsOut(
//         defaultDCA.mul(2),
//         defaultSwapPath
//       );
//       const amountOutMin2: BigNumber = amounts2[1];
//       const taskData = portfolioDCA.interface.encodeFunctionData("executeDCAs", [
//         [positionId1, positionId2],
//         [
//           { swapAmountOutMin: amountOutMin1, swapPath: defaultSwapPath },
//           { swapAmountOutMin: amountOutMin2, swapPath: defaultSwapPath },
//         ],
//       ]);
//       expect(payload).to.be.eq(taskData);
//     });
//     it("should skip ineligible positions", async () => {
//       const positionId1 = await getNextPositionId(portfolioDCA);
//       await portfolioDCA
//         .connect(alice)
//         .setPosition(
//           usdc.address,
//           weth.address,
//           defaultFund,
//           defaultDCA,
//           defaultInterval,
//           defaultSlippage
//         );

//       const positionId2 = await getNextPositionId(portfolioDCA);
//       await portfolioDCA
//         .connect(bob)
//         .setPosition(
//           usdc.address,
//           weth.address,
//           defaultFund,
//           defaultDCA,
//           defaultInterval,
//           defaultSlippage
//         );

//       const positionId3 = await getNextPositionId(portfolioDCA);
//       await portfolioDCA
//         .connect(bob)
//         .setPosition(
//           usdc.address,
//           weth.address,
//           defaultFund,
//           defaultDCA,
//           defaultInterval,
//           defaultSlippage
//         );

//       // empty position1, trigger interval position2
//       await portfolioDCA.connect(alice).withdrawTokenIn(positionId1, defaultFund);
//       await portfolioDCA.connect(deployer).executeDCA(positionId2, {
//         swapAmountOutMin: 0,
//         swapPath: defaultSwapPath,
//       });

//       const [canExec, payload] = await resolver.getExecutablePositions();
//       expect(canExec).to.be.eq(true);

//       const amounts = await uniRouter.getAmountsOut(
//         defaultDCA,
//         defaultSwapPath
//       );
//       const amountOutMin: BigNumber = amounts[1];

//       const taskData = portfolioDCA.interface.encodeFunctionData("executeDCAs", [
//         [positionId3],
//         [{ swapAmountOutMin: amountOutMin, swapPath: defaultSwapPath }],
//       ]);
//       expect(payload).to.be.eq(taskData);

//       const now = await getCurrentTimestamp();
//       await fastForwardTo(now.add(defaultInterval).toNumber());

//       const [canExec2, payload2] = await resolver.getExecutablePositions();
//       expect(canExec2).to.be.eq(true);

//       const amounts2 = await uniRouter.getAmountsOut(
//         defaultDCA,
//         defaultSwapPath
//       );
//       const amountOutMin2: BigNumber = amounts2[1];

//       const taskData2 = portfolioDCA.interface.encodeFunctionData("executeDCAs", [
//         [positionId2, positionId3],
//         [
//           { swapAmountOutMin: amountOutMin2, swapPath: defaultSwapPath },
//           { swapAmountOutMin: amountOutMin2, swapPath: defaultSwapPath },
//         ],
//       ]);
//       expect(payload2).to.be.eq(taskData2);
//     });
//   });
// });
