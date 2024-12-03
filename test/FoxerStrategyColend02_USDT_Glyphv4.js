const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const ERC20ABI = require("../abis/ERC20.json");
const dotenv = require("dotenv");
dotenv.config({path: __dirname + '/../' + network.name + '.env'})


describe("FoxerStrategyColend02_USDT_Glyphv4", async () => {
    let owner = (await ethers.getSigners())[0];
    let tester = (await ethers.getSigners())[1];
    let tester2 = (await ethers.getSigners())[2];
    let admin = (await ethers.getSigners())[3];
    let feeRecipient = (await ethers.getSigners())[4];
    let tester3 = (await ethers.getSigners())[5];
    let coreBTC = await ethers.getContractAt(ERC20ABI, process.env.BTC_ADDRESS);
    let USDT = await ethers.getContractAt(ERC20ABI, process.env.USDT_ADDRESS);
    let WCORE = await ethers.getContractAt(ERC20ABI, process.env.WCORE_ADDRESS);

    let strategy = ethers.Contract;
    let vault = ethers.Contract;

    beforeEach(async () => {

        const deployFoxerStrategyColend02 = await ethers.deployContract("FoxerStrategyColend02",
            [
                admin.address,
                USDT.target,
                coreBTC.target,
                feeRecipient.address,
                50,
                process.env.COLEND_DATA_PROVIDER_ADDRESS,
                process.env.GLYPH_ROUTER_V4_ADDRESS,
                10000n, // 0.01 USDT minumum swap threshold
            ],
            {
                signer: owner,
                gasPrice: ethers.parseUnits('1', 'gwei')
            }
        );
        const tx = deployFoxerStrategyColend02.deploymentTransaction();
        await tx.wait();
        await deployFoxerStrategyColend02.waitForDeployment();
        console.log('strategy:', deployFoxerStrategyColend02.target);

        strategy = await ethers.getContractAt("FoxerStrategyColend02", deployFoxerStrategyColend02.target);

        // Best route = USDT -> WCORE -> coreBTC
        await strategy.connect(admin).setSwapHops(
            [ USDT.target, WCORE.target, coreBTC.target ],
            {
                gasPrice: ethers.parseUnits('1', 'gwei')
            }
        );

        console.log('------------------------------------------------');

        const deployFoxerVault = await ethers.deployContract("FoxerVaultV2",
            [
                admin.address,
                coreBTC.target,
                strategy.target,
                "Foxer USDT",
                "fxUSDT",
                60,
            ],
            {
                signer: owner,
                gasPrice: ethers.parseUnits('1', 'gwei')
            }
        );
        const tx4 = deployFoxerVault.deploymentTransaction();
        await tx4.wait();
        await deployFoxerVault.waitForDeployment();
        console.log('vault:', deployFoxerVault.target);

        vault = await ethers.getContractAt("FoxerVaultV2", deployFoxerVault.target);

        // console.log('strategy.setVault...');
        await strategy.connect(admin).setVault(vault.target, {
            gasPrice: ethers.parseUnits('1', 'gwei')
        });

    });

    it("should be able to deposit", async () => {
        console.log('strategy:', strategy.target);
        console.log('vault:', vault.target);

        const tr1 = await USDT.connect(tester3).transfer(tester.address, ethers.parseUnits('100', 6));
        await tr1.wait();
        const tr2 = await USDT.connect(tester3).transfer(tester2.address, ethers.parseUnits('100', 6));
        await tr2.wait();

        const USDTBalance = await USDT.balanceOf(tester.address);
        console.log('USDT Balance (1):', ethers.formatUnits(USDTBalance.toString(), 6));

        const USDTBalance2 = await USDT.balanceOf(tester2.address);
        console.log('USDT Balance (2):', ethers.formatUnits(USDTBalance2.toString(), 6));

        // USDTBalance must be at least 100
        expect(USDTBalance, 'USDT Balance of tester 1 must be at least $100').to.be.gte(ethers.parseUnits('100', 6));
        expect(USDTBalance2, 'USDT Balance of tester 2 must be at least $100').to.be.gte(ethers.parseUnits('100', 6));

        console.log('Approve USDT...');
        await USDT.connect(tester).approve(vault.target, USDTBalance);
        await USDT.connect(tester2).approve(vault.target, USDTBalance2);

        console.log('Deposit USDT...');
        await vault.connect(tester).deposit(USDTBalance, 1666);

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
        console.log('rewards:', ethers.formatUnits(rewards.toString(), 6), 'USDT estimated to be converted to coreBTC');

        let rd = await vault.accRewardPerShare();
        let rd1 = await vault.userRewardDebt(tester.address);
        let rd2 = await vault.userRewardDebt(tester2.address);
        console.log('* accRewardPerShare       :', ethers.formatUnits(rd.toString(), 12));
        console.log('* userRewardDebt (tester) :', ethers.formatUnits(rd1.toString(), 12));
        console.log('* userRewardDebt (tester2):', ethers.formatUnits(rd2.toString(), 12));

        // Harvest
        console.log('--------------------------');
        console.log('[Tester 1] Harvest...');

        await vault.connect(tester).harvest(1666);

        const coreBTCBalanceAfter1 = await coreBTC.balanceOf(tester.address);
        console.log('coreBTCBalance after (tester):', ethers.formatUnits(coreBTCBalanceAfter1.toString(), 8));

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
        await vault.connect(tester2).deposit(USDTBalance2, 1666);

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


        const coreBTCBalance = await coreBTC.balanceOf(tester.address);
        console.log('coreBTCBalance (tester):', ethers.formatUnits(coreBTCBalance.toString(), 8));

        const coreBTCBalanceFeeRecipient = await coreBTC.balanceOf(feeRecipient.address);
        console.log('coreBTCBalance (feeRecipient):', ethers.formatUnits(coreBTCBalanceFeeRecipient.toString(), 8));

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
        await vault.connect(tester).withdraw(fxUsdtBalance, 1666);

        // Simulate 1 hour wait
        console.log('Simulating wait around 1 year and 15,768,000 blocks...');
        await ethers.provider.send('evm_increaseTime', [86400 * 365]);
        await ethers.provider.send('hardhat_mine', ["0xF099C0"]);

        console.log('--------------------------');
        console.log('[Tester 2] Harvest...');

        const estimated2 = await vault.estimatedPendingRewards(tester2.address);
        console.log('estimated2:', ethers.formatUnits(estimated2.toString(), 8));

        const tester2coreBTCBefore = await coreBTC.balanceOf(tester2.address);
        console.log('coreBTCBalance before (tester2):', ethers.formatUnits(tester2coreBTCBefore.toString(), 8));

        await vault.connect(tester2).harvest(1666);

        const tester2coreBTCAfter = await coreBTC.balanceOf(tester2.address);
        console.log('coreBTCBalance after (tester2):', ethers.formatUnits(tester2coreBTCAfter.toString(), 8));

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

        const USDTBalance3 = await USDT.balanceOf(tester.address);
        console.log('USDTBalance (tester):', ethers.formatUnits(USDTBalance3.toString(), 6));

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

        const vaultcoreBTCBalance = await coreBTC.balanceOf(vault.target);
        console.log('coreBTCBalance (vault):', ethers.formatUnits(vaultcoreBTCBalance.toString(), 8));

        const aTokenBalance = await aUSDT.balanceOf(strategy.target);
        console.log('aTokenBalance (strat):', ethers.formatUnits(aTokenBalance.toString(), 6));

        const USDTBalanceStrat = await USDT.balanceOf(strategy.target);
        console.log('USDT Balance (strat):', ethers.formatUnits(USDTBalanceStrat.toString(), 6));

        rd = await vault.accRewardPerShare();
        rd1 = await vault.userRewardDebt(tester.address);
        rd2 = await vault.userRewardDebt(tester2.address);
        console.log('* accRewardPerShare       :', rd);
        console.log('* userRewardDebt (tester) :', rd1);
        console.log('* userRewardDebt (tester2):', rd2);

        console.log('[Tester 2] Withdraw:', fxUsdtBalance2, 'fxUSDT');
        await vault.connect(tester2).withdraw(fxUsdtBalance2, 1666);

        const USDTBalance4 = await USDT.balanceOf(tester2.address);
        console.log('USDTBalance (tester2):', ethers.formatUnits(USDTBalance4.toString(), 6));

        const coreBTCBalance2 = await coreBTC.balanceOf(tester2.address);
        console.log('coreBTCBalance (tester2):', ethers.formatUnits(coreBTCBalance2.toString(), 8));

        const aUSDTBalance4 = await aUSDT.balanceOf(strategy.target);
        console.log('aUSDTBalance (strat):', ethers.formatUnits(aUSDTBalance4.toString(), 6));


        expect(strategy).to.be.ok;
        expect(vault).to.be.ok;
    });


});
