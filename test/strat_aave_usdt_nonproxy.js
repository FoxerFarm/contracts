const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const ERC20ABI = require("../abis/ERC20.json");
const dotenv = require("dotenv");
dotenv.config({path: __dirname + '/../' + network.name + '.env'})


describe("ThenaDepositor", async () => {
    let owner = (await ethers.getSigners())[0];
    let admin = (await ethers.getSigners())[1];
    let feeRecipient = (await ethers.getSigners())[1];
    let tester = (await ethers.getSigners())[2];
    let tester2 = (await ethers.getSigners())[3];
    let wbtc = await ethers.getContractAt(ERC20ABI, process.env.BTC_ADDRESS);
    let usdt = await ethers.getContractAt(ERC20ABI, process.env.USDT_ADDRESS);

    let strategy = ethers.Contract;
    let vault = ethers.Contract;

    beforeEach(async () => {

        const deployStrategyImplementation = await ethers.deployContract("FoxerStrategyColend01",
            [],
            {
                signer: owner,
                gasPrice: ethers.parseUnits('1', 'gwei')
            }
        );
        const tx = deployStrategyImplementation.deploymentTransaction();
        await tx.wait();
        await deployStrategyImplementation.waitForDeployment();
        console.log('strategy implementation:', deployStrategyImplementation.target);

        const deployStrategyFactory = await ethers.deployContract("FoxerStrategyColend01Factory",
            [
                deployStrategyImplementation.target
            ],
            {
                signer: owner,
                gasPrice: ethers.parseUnits('1', 'gwei')
            }
        );
        const tx2 = deployStrategyFactory.deploymentTransaction();
        await tx2.wait();
        await deployStrategyFactory.waitForDeployment();
        console.log('strategy factory:', deployStrategyFactory.target);

        const strategyFactory = await ethers.getContractAt("FoxerStrategyColend01Factory", deployStrategyFactory.target);
        const tx3 = await strategyFactory.createClone(
            admin.address,
            process.env.USDT_ADDRESS,
            process.env.BTC_ADDRESS,
            feeRecipient.address,
            50,
            process.env.AAVE_DATA_PROVIDER_ADDRESS,
            process.env.UNISWAP_V3_SWAP_ROUTER_ADDRESS,
            10000n, // 0.01 USDT minumum swap threshold
            process.env.CHAINLINK_WBTC_USD_ORACLE_ADDRESS,
            {
                signer: owner,
                gasPrice: ethers.parseUnits('1', 'gwei')
            }
        );
        await tx3.wait();

        // Get latest clone
        const strategyClone = await strategyFactory.latestClone();
        console.log('strategy clone:', strategyClone);

        strategy = await ethers.getContractAt("FoxerStrategyColend01", strategyClone);

        // Best route = USDT -> USDC (0.01% fee pool), then USDC -> WBTC (0.05% fee pool)
        await strategy.connect(admin).setSwapHops(
            [ process.env.USDT_ADDRESS, process.env.USDC_E_ADDRESS ],
            [ 100, 500 ],
            [ process.env.USDC_E_ADDRESS, process.env.BTC_ADDRESS ],
            {
                gasPrice: ethers.parseUnits('1', 'gwei')
            }
        );

        console.log('------------------------------------------------');

        const deployVaultImplementation = await ethers.deployContract("FoxerVault",
            [],
            {
                signer: owner,
                gasPrice: ethers.parseUnits('1', 'gwei')
            }
        );
        const tx4 = deployVaultImplementation.deploymentTransaction();
        await tx4.wait();
        await deployVaultImplementation.waitForDeployment();
        console.log('vault implementation:', deployVaultImplementation.target);

        const deployVaultFactory = await ethers.deployContract("FoxerVaultFactory",
            [
                deployVaultImplementation.target
            ],
            {
                signer: owner,
                gasPrice: ethers.parseUnits('1', 'gwei')
            }
        );
        const tx5 = deployVaultFactory.deploymentTransaction();
        await tx5.wait();
        await deployVaultFactory.waitForDeployment();
        console.log('vault factory:', deployVaultFactory.target);

        const vaultFactory = await ethers.getContractAt("FoxerVaultFactory", deployVaultFactory.target);
        const tx6 = await vaultFactory.createClone(
            admin.address,
            process.env.BTC_ADDRESS,
            strategy.target,
            "Foxer USDT",
            "fxUSDT",
            60,
            {
                signer: owner,
                gasPrice: ethers.parseUnits('1', 'gwei')
            }
        );
        await tx6.wait();

        // Get latest clone
        const vaultClone = await vaultFactory.latestClone();
        console.log('vault clone:', vaultClone);

        vault = await ethers.getContractAt("FoxerVault", vaultClone);

        // console.log('strategy.setVault...');
        await strategy.connect(admin).setVault(vault.target, {
            gasPrice: ethers.parseUnits('1', 'gwei')
        });

    });

    it("should be able to deposit", async () => {
        console.log('strategy:', strategy.target);
        console.log('vault:', vault.target);

        console.log('Send 50 USDT to tester2');
        await usdt.connect(tester).transfer(tester2.address, ethers.parseUnits('50', 6));

        const usdtBalance = await usdt.balanceOf(tester.address);
        console.log('usdtBalance:', ethers.formatUnits(usdtBalance.toString(), 6));

        const usdtBalance2 = await usdt.balanceOf(tester2.address);
        console.log('usdtBalance:', ethers.formatUnits(usdtBalance2.toString(), 6));

        console.log('Approve USDT...');
        await usdt.connect(tester).approve(vault.target, usdtBalance);
        await usdt.connect(tester2).approve(vault.target, usdtBalance2);

        console.log('Deposit USDT...');
        await vault.connect(tester).deposit(usdtBalance);

        console.log('Get balance of fxUSDT...');
        const fxUsdtBalance = await vault.balanceOf(tester.address);
        console.log('fxUsdtBalance:', ethers.formatUnits(fxUsdtBalance.toString(), 6));

        const aUSDT = await ethers.getContractAt(ERC20ABI, await strategy.aToken());
        const aUSDTBalance = await aUSDT.balanceOf(strategy.target);
        console.log('aUSDTBalance (strat):', ethers.formatUnits(aUSDTBalance.toString(), 6));

        // Simulate 1 hour wait
        console.log('Simulating wait around 1 year and 15,768,000 blocks...');
        await ethers.provider.send('evm_increaseTime', [86400 * 365]);
        await ethers.provider.send('hardhat_mine', ["0xF099C0"]);

        const aUSDTBalance2 = await aUSDT.balanceOf(strategy.target);
        console.log('aUSDTBalance (strat):', ethers.formatUnits(aUSDTBalance2.toString(), 6));

        // Check available rewards
        console.log('Get available rewards...');
        const rewards = await strategy.estimatedRewardsAvailable();
        console.log('rewards:', ethers.formatUnits(rewards.toString(), 8), 'WBTC estimated');

        let rd = await vault.accRewardPerShare();
        let rd1 = await vault.userRewardDebt(tester.address);
        let rd2 = await vault.userRewardDebt(tester2.address);
        console.log('* accRewardPerShare       :', ethers.formatUnits(rd.toString(), 12));
        console.log('* userRewardDebt (tester) :', ethers.formatUnits(rd1.toString(), 12));
        console.log('* userRewardDebt (tester2):', ethers.formatUnits(rd2.toString(), 12));

        // Harvest
        console.log('--------------------------');
        console.log('[Tester 1] Harvest...');

        const estimated1 = await vault.estimatedPendingRewards(tester.address);
        console.log('estimated1:', ethers.formatUnits(estimated1.toString(), 8));

        await vault.connect(tester).harvest();

        const wbtcBalanceAfter1 = await wbtc.balanceOf(tester.address);
        console.log('wbtcBalance after (tester):', ethers.formatUnits(wbtcBalanceAfter1.toString(), 8));

        rd = await vault.accRewardPerShare();
        rd1 = await vault.userRewardDebt(tester.address);
        rd2 = await vault.userRewardDebt(tester2.address);
        console.log('* accRewardPerShare       :', rd);
        console.log('* userRewardDebt (tester) :', rd1);
        console.log('* userRewardDebt (tester2):', rd2);

        // Simulate 1 hour wait
        console.log('Simulating wait around 1 year and 15,768,000 blocks...');
        await ethers.provider.send('evm_increaseTime', [86400 * 365]);
        await ethers.provider.send('hardhat_mine', ["0xF099C0"]);

        console.log('--------------------------');
        console.log('[Tester 1] Send half of his shares to tester 2');

        const halfFxUsdtBalance = fxUsdtBalance / 2n;
        console.log('halfFxUsdtBalance:', halfFxUsdtBalance);

        await vault.connect(tester).transfer(tester2.address, halfFxUsdtBalance);

        const fxUsdtBalanceAfterTransfer = await vault.balanceOf(tester.address);
        console.log('fxUsdtBalance (tester, after):', fxUsdtBalanceAfterTransfer);

        const fxUsdtBalance2AfterTransfer = await vault.balanceOf(tester2.address);
        console.log('fxUsdtBalance (tester2, after):', fxUsdtBalance2AfterTransfer);

        // Simulate 1 hour wait
        console.log('Simulating wait around 1 year and 15,768,000 blocks...');
        await ethers.provider.send('evm_increaseTime', [86400 * 365]);
        await ethers.provider.send('hardhat_mine', ["0xF099C0"]);

        console.log('--------------------------');
        console.log('[Tester 2] deposit...');
        await vault.connect(tester2).deposit(usdtBalance2);

        const fxUsdtBalance2 = await vault.balanceOf(tester2.address);
        console.log('fxUsdtBalance (tester2):', ethers.formatUnits(fxUsdtBalance2.toString(), 6));

        rd = await vault.accRewardPerShare();
        rd1 = await vault.userRewardDebt(tester.address);
        rd2 = await vault.userRewardDebt(tester2.address);
        console.log('* accRewardPerShare       :', rd);
        console.log('* userRewardDebt (tester) :', rd1);
        console.log('* userRewardDebt (tester2):', rd2);

        // Simulate 1 hour wait
        console.log('Simulating wait around 1 year and 15,768,000 blocks...');
        await ethers.provider.send('evm_increaseTime', [86400 * 365]);
        await ethers.provider.send('hardhat_mine', ["0xF099C0"]);


        const wbtcBalance = await wbtc.balanceOf(tester.address);
        console.log('wbtcBalance (tester):', ethers.formatUnits(wbtcBalance.toString(), 8));

        const wbtcBalanceFeeRecipient = await wbtc.balanceOf(feeRecipient.address);
        console.log('wbtcBalance (feeRecipient):', ethers.formatUnits(wbtcBalanceFeeRecipient.toString(), 8));

        const aUSDTBalance3 = await aUSDT.balanceOf(strategy.target);
        console.log('aUSDTBalance (strat):', ethers.formatUnits(aUSDTBalance3.toString(), 6));

        const vaultBalance = await vault.balance();
        console.log('vault balance():', ethers.formatUnits(vaultBalance.toString(), 6));


        rd = await vault.accRewardPerShare();
        rd1 = await vault.userRewardDebt(tester.address);
        rd2 = await vault.userRewardDebt(tester2.address);
        console.log('* accRewardPerShare       :', rd);
        console.log('* userRewardDebt (tester) :', rd1);
        console.log('* userRewardDebt (tester2):', rd2);

        console.log('[Tester 1] Withdraw...');
        await vault.connect(tester).withdraw(fxUsdtBalance);

        // Simulate 1 hour wait
        console.log('Simulating wait around 1 year and 15,768,000 blocks...');
        await ethers.provider.send('evm_increaseTime', [86400 * 365]);
        await ethers.provider.send('hardhat_mine', ["0xF099C0"]);

        console.log('--------------------------');
        console.log('[Tester 2] Harvest...');

        const estimated2 = await vault.estimatedPendingRewards(tester2.address);
        console.log('estimated2:', ethers.formatUnits(estimated2.toString(), 8));

        const tester2WbtcBefore = await wbtc.balanceOf(tester2.address);
        console.log('wbtcBalance before (tester2):', ethers.formatUnits(tester2WbtcBefore.toString(), 8));

        await vault.connect(tester2).harvest();

        const tester2WbtcAfter = await wbtc.balanceOf(tester2.address);
        console.log('wbtcBalance after (tester2):', ethers.formatUnits(tester2WbtcAfter.toString(), 8));

        // Simulate 1 hour wait
        console.log('Simulating wait around 1 year and 15,768,000 blocks...');
        await ethers.provider.send('evm_increaseTime', [86400 * 365]);
        await ethers.provider.send('hardhat_mine', ["0xF099C0"]);

        rd = await vault.accRewardPerShare();
        rd1 = await vault.userRewardDebt(tester.address);
        rd2 = await vault.userRewardDebt(tester2.address);
        console.log('* accRewardPerShare       :', rd);
        console.log('* userRewardDebt (tester) :', rd1);
        console.log('* userRewardDebt (tester2):', rd2);

        const usdtBalance3 = await usdt.balanceOf(tester.address);
        console.log('usdtBalance (tester):', ethers.formatUnits(usdtBalance3.toString(), 6));

        // Simulate 1 hour wait
        console.log('Simulating wait around 1 year and 15,768,000 blocks...');
        await ethers.provider.send('evm_increaseTime', [86400 * 365]);
        await ethers.provider.send('hardhat_mine', ["0xF099C0"]);

        console.log('--------------------------');
        // tester 2 withdraw
        const fxUsdtBalance3 = await vault.balanceOf(tester2.address);
        console.log('fxUsdtBalance (tester2):', ethers.formatUnits(fxUsdtBalance3.toString(), 6));

        const vaultTotalSupply = await vault.totalSupply();
        console.log('vaultTotalSupply:', ethers.formatUnits(vaultTotalSupply.toString(), 6));

        const stratTvl = await strategy.tvl();
        console.log('stratTvl:', ethers.formatUnits(stratTvl.toString(), 6));

        const estimatedPendingRewards2 = await vault.estimatedPendingRewards(tester2.address);
        console.log('estimatedPendingRewards (tester2):', ethers.formatUnits(estimatedPendingRewards2.toString(), 8));

        const harvestableRewards = await vault.harvestableRewards(tester2.address);
        console.log('harvestableRewards:', ethers.formatUnits(harvestableRewards.toString(), 8));

        const vaultWbtcBalance = await wbtc.balanceOf(vault.target);
        console.log('wbtcBalance (vault):', ethers.formatUnits(vaultWbtcBalance.toString(), 8));

        const aTokenBalance = await aUSDT.balanceOf(strategy.target);
        console.log('aTokenBalance (strat):', ethers.formatUnits(aTokenBalance.toString(), 6));

        const usdtBalanceStrat = await usdt.balanceOf(strategy.target);
        console.log('USDT Balance (strat):', ethers.formatUnits(usdtBalanceStrat.toString(), 6));

        rd = await vault.accRewardPerShare();
        rd1 = await vault.userRewardDebt(tester.address);
        rd2 = await vault.userRewardDebt(tester2.address);
        console.log('* accRewardPerShare       :', rd);
        console.log('* userRewardDebt (tester) :', rd1);
        console.log('* userRewardDebt (tester2):', rd2);

        console.log('[Tester 2] Withdraw:', fxUsdtBalance2, 'fxUSDT');
        await vault.connect(tester2).withdraw(fxUsdtBalance2);

        const usdtBalance4 = await usdt.balanceOf(tester2.address);
        console.log('usdtBalance (tester2):', ethers.formatUnits(usdtBalance4.toString(), 6));

        const wbtcBalance2 = await wbtc.balanceOf(tester2.address);
        console.log('wbtcBalance (tester2):', ethers.formatUnits(wbtcBalance2.toString(), 8));

        const aUSDTBalance4 = await aUSDT.balanceOf(strategy.target);
        console.log('aUSDTBalance (strat):', ethers.formatUnits(aUSDTBalance4.toString(), 6));


        expect(strategy).to.be.ok;
        expect(vault).to.be.ok;
    });


});
