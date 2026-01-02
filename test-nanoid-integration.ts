import { nanoid } from 'nanoid';

console.log("Testing NanoID...");
const id = nanoid(10);
console.log(`Generated ID: ${id}`);
console.log(`Length: ${id.length}`);

if (id.length !== 10) {
    console.error("Error: ID length is not 10");
    process.exit(1);
}

console.log("NanoID test passed.");
