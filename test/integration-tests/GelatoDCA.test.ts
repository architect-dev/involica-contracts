import { ethers, network } from "hardhat";
import {
  PortfolioDCA,
  PortfolioDCAResolver,
  PortfolioDCAResolver__factory,
  PortfolioDCA__factory,
  IERC20,
  IOps,
} from "../../typechain";

import chai from "chai";
import { solidity } from "ethereum-waffle";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  ETH_TOKEN_ADDRESS,
  GELATO_ADDRESS,
  OPS_ADDRESS,
  ROUTER_ADDRESS,
  TASK_TREASURY_ADDRESS,
  USDC_ADDRESS,
  USDC_DECIMALS,
  WBTC_ADDRESS,
  WETH_ADDRESS,
  WETH_SYMBOL,
} from "../../constants";
import { BigNumber, BigNumberish } from "@ethersproject/bignumber";
import {
  fastForwardTo,
  getCurrentTimestamp,
  impersonateAccount,
  mintUsdc,
} from "../helpers/utils";
import { parseEther, parseUnits } from "@ethersproject/units";
import { toUtf8String } from "ethers/lib/utils";

const { expect } = chai;
chai.use(solidity);

describe("Integration Test: Gelato DCA", function () {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let executor: SignerWithAddress;
  let deployerAddress: string;
  let aliceAddress: string;
  let bobAddress: string;
  let gelatoAddress: string;

  let portfolioDCA: PortfolioDCA;
  let resolver: PortfolioDCAResolver;
  let opsContract: IOps;
  let gelato: SignerWithAddress;

  let usdc: IERC20;
  let weth: IERC20;
  let wbtc: IERC20;

  let defaultTreasuryFund: BigNumber;
  let defaultFund: BigNumber;
  let defaultEtherFund: BigNumber;
  let defaultDCA: BigNumber;
  let defaultEtherDCA: BigNumber;
  let defaultSlippage: BigNumber;
  let defaultInterval: BigNumberish;
  let defaultGasPrice: BigNumberish
  let defaultGelatoFee: BigNumber;
  let usdcSwapRoute: string[];
  let wethSwapRoute: string[];
  let btcSwapRoute: string[];

  let emptyBytes32: string;

  let executeDCASelector: string;
  let aliceResolverHash: string;
  let bobResolverHash: string;

  let snapshotId: string;
  const chainId = 250;

  before("setup contracts", async () => {
    [deployer, alice, bob] = await ethers.getSigners();
    deployerAddress = deployer.address;
    aliceAddress = alice.address;
    bobAddress = bob.address;

    usdc = <IERC20>await ethers.getContractAt("IERC20", USDC_ADDRESS[chainId]);
    weth = <IERC20>await ethers.getContractAt("IERC20", WETH_ADDRESS[chainId]);
    wbtc = <IERC20>await ethers.getContractAt("IERC20", WBTC_ADDRESS[chainId]);
    
    
    defaultTreasuryFund = parseEther("0.5");
    defaultFund = parseUnits("10000", USDC_DECIMALS);
    defaultEtherFund = parseEther("1000")
    defaultDCA = defaultFund.div(10);
    defaultEtherDCA = defaultEtherFund.div(10);
    defaultInterval = 60; // second;
    usdcSwapRoute = [weth.address, usdc.address];
    wethSwapRoute = [usdc.address, weth.address];
    btcSwapRoute = [usdc.address, weth.address, wbtc.address];
    defaultGasPrice = 100;
    defaultGelatoFee = parseEther("0.05")

    emptyBytes32 = ethers.utils.hexZeroPad(BigNumber.from(0).toHexString(), 32)
    

    // PORTFOLIO DCA
    const PortfolioDCAFactory = (await ethers.getContractFactory(
      "PortfolioDCA",
      deployer
    )) as PortfolioDCA__factory;
    
    portfolioDCA = await PortfolioDCAFactory.deploy(
      OPS_ADDRESS[chainId],
      ROUTER_ADDRESS[chainId],
      weth.address,
      WETH_SYMBOL[chainId]
    );
    await portfolioDCA.deployed();
    defaultSlippage = await portfolioDCA.minSlippage();

    await portfolioDCA
      .connect(deployer)
      .setAllowedTokens(
        [usdc.address, wbtc.address],
        ['USDC', 'wBTC'], 
        [true, true]
      );


    // PORTFOLIO DCA RESOLVER
    const PortfolioDCAResolverFactory = (await ethers.getContractFactory(
      "PortfolioDCAResolver",
      deployer
    )) as PortfolioDCAResolver__factory;
    resolver = await PortfolioDCAResolverFactory.deploy(
      portfolioDCA.address,
      ROUTER_ADDRESS[chainId]
    );
    await resolver.deployed();

    await portfolioDCA.connect(deployer).setResolver(resolver.address)

    await mintUsdc(chainId, defaultFund.mul(100), aliceAddress);
    await mintUsdc(chainId, defaultFund.mul(100), bobAddress);

    await usdc
      .connect(alice)
      .approve(portfolioDCA.address, ethers.constants.MaxUint256);
    await usdc
      .connect(bob)
      .approve(portfolioDCA.address, ethers.constants.MaxUint256);

    
    // OPS CONTRACT
    opsContract = <IOps>(
      await ethers.getContractAt("IOps", OPS_ADDRESS[chainId])
    );

    executeDCASelector = portfolioDCA.interface.getSighash("executeDCA");
    const getResolverHash = async (userAddress: string) => {
      const resolverData = resolver.interface.encodeFunctionData("checkPositionExecutable", [userAddress]);
      return await opsContract.getResolverHash(resolver.address, resolverData);
    }
    aliceResolverHash = await getResolverHash(alice.address)
    bobResolverHash = await getResolverHash(bob.address)


    // IMPERSONATE GELATO
    gelatoAddress = await opsContract.gelato()

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [gelatoAddress],
    });
  
    gelato = await ethers.getSigner(gelatoAddress);

    await network.provider.send("hardhat_setBalance", [
      gelatoAddress,
      parseEther('1')._hex.replace("0x0", "0x"),
    ]);


    // TAKE SNAPSHOT
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  beforeEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  describe("Gelato DCA", async () => {
    it("should DCA until funds run out, then finalize with Insufficient funds", async () => {
      await portfolioDCA
        .connect(alice)
        .setPosition(
          defaultTreasuryFund,
          usdc.address,
          [{
            token: weth.address,
            weight: 10000,
            route: wethSwapRoute,
            maxSlippage: defaultSlippage
          }],
          defaultFund,
          defaultDCA,
          defaultInterval,
          defaultGasPrice,
          { value: defaultTreasuryFund }
        );

      const balanceBeforeUsdc = await usdc.balanceOf(portfolioDCA.address);
      const balanceBeforeWeth = await weth.balanceOf(portfolioDCA.address);

      let finalizationReason = "";
      let iteration = 0;
      while (iteration < 15 && finalizationReason !== "Insufficient funds") {
        const [canExec, payload] = await resolver.checkPositionExecutable(alice.address);
        expect(canExec).to.be.eq(true);

        await opsContract
          .connect(gelato)
          .exec(
            defaultGelatoFee.div(2),
            ETH_TOKEN_ADDRESS,
            portfolioDCA.address,
            false,
            true,
            aliceResolverHash,
            portfolioDCA.address,
            payload
          );

        const now = await getCurrentTimestamp();
        await fastForwardTo(now.add(defaultInterval).toNumber());

        const position = (await portfolioDCA.fetchData(alice.address)).position;
        finalizationReason = position.finalizationReason
        iteration++;
      }

      const position = (await portfolioDCA.fetchData(alice.address)).position;
      expect(position.finalizationReason).to.be.eq("Insufficient funds")
      expect(position.taskId).to.be.eq(emptyBytes32)

      const balanceAfterUsdc = await usdc.balanceOf(portfolioDCA.address);
      const balanceAfterWeth = await weth.balanceOf(portfolioDCA.address);

      expect(balanceBeforeUsdc.sub(balanceAfterUsdc)).to.be.eq(defaultFund);
      expect(balanceAfterWeth.sub(balanceBeforeWeth)).to.be.gt(0);
    });
    it("should DCA until treasury run out, then finalize with Treasury out of gas", async () => {
      await portfolioDCA
        .connect(alice)
        .setPosition(
          defaultTreasuryFund,
          usdc.address,
          [{
            token: weth.address,
            weight: 10000,
            route: wethSwapRoute,
            maxSlippage: defaultSlippage
          }],
          defaultFund,
          defaultDCA,
          defaultInterval,
          defaultGasPrice,
          { value: defaultTreasuryFund }
        );

      const balanceBeforeUsdc = await usdc.balanceOf(portfolioDCA.address);
      const balanceBeforeWeth = await weth.balanceOf(portfolioDCA.address);

      let finalizationReason = "";
      let iteration = 0;
      while (iteration < 15 && finalizationReason !== "Treasury out of gas") {
        const [canExec, payload] = await resolver.checkPositionExecutable(alice.address);
        expect(canExec).to.be.eq(true);

        const tx = await opsContract
          .connect(gelato)
          .exec(
            defaultGelatoFee.mul(2),
            ETH_TOKEN_ADDRESS,
            portfolioDCA.address,
            false,
            true,
            aliceResolverHash,
            portfolioDCA.address,
            payload
          );

        const now = await getCurrentTimestamp();
        await fastForwardTo(now.add(defaultInterval).toNumber());
        
        const position = (await portfolioDCA.fetchData(alice.address)).position;
        finalizationReason = position.finalizationReason
        iteration++;

        if (finalizationReason == "") {
          expect(tx).to.changeEtherBalance(portfolioDCA, defaultGelatoFee.mul(-2))
        }
      }

      const position = (await portfolioDCA.fetchData(alice.address)).position;
      expect(position.finalizationReason).to.be.eq("Treasury out of gas")
      expect(position.treasury).to.be.eq(0)
      expect(position.taskId).to.be.eq(emptyBytes32)

      const balanceAfterUsdc = await usdc.balanceOf(portfolioDCA.address);
      const balanceAfterWeth = await weth.balanceOf(portfolioDCA.address);

      expect(balanceBeforeUsdc.sub(balanceAfterUsdc)).to.be.eq(defaultDCA.mul(iteration - 1));
      expect(balanceAfterWeth.sub(balanceBeforeWeth)).to.be.gt(0);
    });
    it("depositing funds should re-initialize task", async () => {
      // Create position and drain it
      await portfolioDCA
        .connect(alice)
        .setPosition(
          defaultTreasuryFund,
          usdc.address,
          [{
            token: weth.address,
            weight: 10000,
            route: wethSwapRoute,
            maxSlippage: defaultSlippage
          }],
          defaultFund,
          defaultDCA,
          defaultInterval,
          defaultGasPrice,
          { value: defaultTreasuryFund }
        );
      await portfolioDCA
        .connect(alice)
        .withdrawTokenIn(defaultFund)

      const position1 = (await portfolioDCA.fetchData(alice.address)).position;
      expect(position1.finalizationReason).to.be.eq("Insufficient funds")

      // Re-initialize
      const tx = await portfolioDCA.connect(alice).deposit(defaultDCA)

      expect(tx).to.emit(portfolioDCA, "Deposit").withArgs(alice.address, usdc.address, defaultDCA)
      expect(tx).to.emit(portfolioDCA, "InitializeTask")    

      const position2 = (await portfolioDCA.fetchData(alice.address)).position;
      expect(position2.finalizationReason).to.be.eq("")

      const [canExec2, payload2] = await resolver.checkPositionExecutable(alice.address);
      const execTx2 = await opsContract
        .connect(gelato)
        .exec(
          defaultGelatoFee.div(2),
          ETH_TOKEN_ADDRESS,
          portfolioDCA.address,
          false,
          true,
          aliceResolverHash,
          portfolioDCA.address,
          payload2
        );

      expect(execTx2).to.emit(portfolioDCA, "ExecuteDCA").withArgs(alice.address)
    })
    it("depositing treasury funds should re-initialize task", async () => {
      // Create position and drain it
      await portfolioDCA
        .connect(alice)
        .setPosition(
          defaultTreasuryFund,
          usdc.address,
          [{
            token: weth.address,
            weight: 10000,
            route: wethSwapRoute,
            maxSlippage: defaultSlippage
          }],
          defaultFund,
          defaultDCA,
          defaultInterval,
          defaultGasPrice,
          { value: defaultTreasuryFund }
        );
      await portfolioDCA
        .connect(alice)
        .withdrawFromTreasury(defaultTreasuryFund)

      const position1 = (await portfolioDCA.fetchData(alice.address)).position;
      expect(position1.finalizationReason).to.be.eq("Treasury out of gas")

      // Re-initialize
      const tx = await portfolioDCA.connect(alice).depositToTreasury({ value: defaultTreasuryFund })

      expect(tx).to.emit(portfolioDCA, "DepositToTreasury").withArgs(alice.address, defaultTreasuryFund)
      expect(tx).to.emit(portfolioDCA, "InitializeTask")    

      const position2 = (await portfolioDCA.fetchData(alice.address)).position;
      expect(position2.finalizationReason).to.be.eq("")

      const [canExec2, payload2] = await resolver.checkPositionExecutable(alice.address);
      const execTx2 = await opsContract
        .connect(gelato)
        .exec(
          defaultGelatoFee.div(2),
          ETH_TOKEN_ADDRESS,
          portfolioDCA.address,
          false,
          true,
          aliceResolverHash,
          portfolioDCA.address,
          payload2
        );

      expect(execTx2).to.emit(portfolioDCA, "ExecuteDCA").withArgs(alice.address)
    })
  });
});
