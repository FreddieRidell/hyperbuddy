import hyperdb from "hyperdb";
import ram from "random-access-memory";
import net from "net";
import portfinder from "portfinder";

const announcePort = 12237 || process.env.HYPER_BUDDY_PORT;

const dbs = {};

const onReplicateConnection = (
	inputKeyBuffer,
	closeServer,
) => async replicateConnection => {
	const dbKeyString = inputKeyBuffer.toString("base64");

	const db = await new Promise(done => {
		if (dbs[dbKeyString]) {
			done(dbs[dbKeyString]);
		} else {
			const db = hyperdb(ram, inputKeyBuffer);

			db.on("ready", () => {
				dbs[dbKeyString] = db;
				done(db);
			});
		}
	});

	const stream = db.replicate({ live: false });
	stream.pipe(replicateConnection).pipe(stream);
	replicateConnection.on("end", () => closeServer());
	replicateConnection.on("error", () => closeServer());
};

const onAnnounceConnection = async announceConnetion => {
	announceConnetion.on("error", e => {
		throw e;
	});

	announceConnetion.on("data", async inputKeyBuffer => {
		const replicatePort = await portfinder.getPortPromise();
		await new Promise(done => {
			const replicationServer = net
				.createServer(
					onReplicateConnection(inputKeyBuffer, () =>
						replicationServer.close(),
					),
				)
				.listen(replicatePort, () => done());
		});
		announceConnetion.write(String(replicatePort));
		announceConnetion.end();
	});
};

export const main = () =>
	new Promise(done => {
		const announceServer = net
			.createServer(onAnnounceConnection)
			.listen(announcePort, () => {
				done(() => {
					return new Promise(fin => announceServer.close(fin));
				});
			});
	});

if (require.main === module) {
	main();
}

export const connectToBuddy = async publicKeyBuffer => {};
