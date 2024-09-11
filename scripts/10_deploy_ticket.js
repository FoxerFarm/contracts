const hre = require("hardhat");
const ethers = hre.ethers;
const network = hre.network;
const upgrades = hre.upgrades;
const dotenv = require("dotenv");
dotenv.config({path: __dirname + '/../' + network.name + '.env'});


async function main() {
    console.log('\x1b[34m%s\x1b[0m', '╔════════════════════════════════════╗');
    console.log('\x1b[34m%s\x1b[0m', '║ deploy FoxiesFarmTicket            ║');
    console.log('\x1b[34m%s\x1b[0m', '╚════════════════════════════════════╝');
    console.log('network: \x1b[34m%s\x1b[0m', network.name);

    const signers = await ethers.getSigners();
    const owner = signers[0];

    console.log('Signer:', owner.address);

    const deployFoxiesFarmTicket = await ethers.deployContract("FoxiesFarmTicket",
        [],
        {
            signer: owner,
            // gasPrice: ethers.parseUnits('1', 'gwei')
        }
    );
    const tx = deployFoxiesFarmTicket.deploymentTransaction();
    await tx.wait();
    await deployFoxiesFarmTicket.waitForDeployment();
    console.log('FoxiesFarmTicket implementation:', deployFoxiesFarmTicket.target);


    console.log('--------------------------------------');

}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
