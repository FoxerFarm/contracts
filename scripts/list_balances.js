const hre = require("hardhat");
const ethers = hre.ethers;
const network = hre.network;
const dotenv = require("dotenv");
dotenv.config({path: __dirname + '/../' + network.name + '.env'});

async function main() {
    const signers = await ethers.getSigners();

    const blockNumber = await ethers.provider.getBlockNumber();
    console.log('Block Number:', blockNumber);

    let total = 0;

    for (let i = 0; i < signers.length; i++) {
        const signer = signers[i];
        const balance = await ethers.provider.getBalance(
            signer.address
        );
        console.log(signer.address, ethers.formatEther(balance));

        total += parseFloat(ethers.formatEther(balance));
    }

    console.log('Total: ', total);

}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
