#!env node

import hyperdb from "hyperdb";
import ram from "random-access-memory";
import net from "net";
import portfinder from "portfinder";
import { spawn } from "child_process";
import hyperswarm from "@hyperswarm/network";

const announcePort = 12237 || process.env.HYPER_BUDDY_PORT;

const dbs = {};

const createNewDb = async inputKeyBuffer => {
	const dbKeyString = inputKeyBuffer.toString("base64");

	const db = await new Promise(done => {
		const db = hyperdb(ram, inputKeyBuffer);

		db.on("ready", () => {
			dbs[dbKeyString] = db;
			done(db);
		});
	});

	const swarm = hyperswarm({ ephemeral: false });
	swarm.join(db.discoveryKey, {
		lookup: true,
		announce: true,
	});
	swarm.on("connection", (socket, details) => {
		const stream = db.replicate({ live: true });
		stream.pipe(socket).pipe(stream);
	});

	return db;
};

const onReplicateConnection = (
	inputKeyBuffer,
	closeServer,
) => async replicateConnection => {
	const dbKeyString = inputKeyBuffer.toString("base64");

	const db = await Promise.resolve(
		dbs[dbKeyString] || createNewDb(inputKeyBuffer),
	);

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

//autorun main if this file is called as an executable
if (require.main === module) {
	if (process.argv[2] === "forever") {
		main();
	} else {
		console.log("spawning hyperbuddy to live forever!!!");
		spawn("node", [require.main.filename, "forever"], {
			detached: true,
		});
		process.exit(0);
	}
}

export const connectToBuddy = async publicKeyBuffer => {
	const createSocketConnectedToPort = port =>
		new Promise((done, fail) => {
			const client = new net.Socket();
			client.on("error", fail);
			client.connect(
				port,
				"localhost",
				(err, dat) => (err ? fail(err) : done(client)),
			);
		});

	try {
		const announceSocket = await createSocketConnectedToPort(announcePort);

		const replicatePort = await new Promise(done => {
			announceSocket.on("data", buf =>
				done(parseInt(buf.toString(), 10)),
			);
			announceSocket.write(publicKeyBuffer);
		});

		return createSocketConnectedToPort(replicatePort);
	} catch (e) {
		console.log(
			`it seems that hyperbuddy is not running, please install @hypercortex/hyperbuddy and run hyperbuddy
(Hyperbuddy will auto start in later versions)`,
		);
		process.exit(1);
	}
};
