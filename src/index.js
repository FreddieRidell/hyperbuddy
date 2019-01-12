#!/usr/bin/env node

import hyperdb from "hyperdb";
import ram from "random-access-memory";
import { spawn } from "child_process";
import hyperswarm from "@hyperswarm/network";

export const main = async inputKeyBuffer => {
	const db = await new Promise(done => {
		const db = hyperdb(ram, inputKeyBuffer);

		db.on("ready", () => {
			done(db);
		});
	});

	const swarm = hyperswarm({ ephemeral: false });
	swarm.on("connection", (socket, details) => {
		socket.pipe(db.replicate({ live: false })).pipe(socket);
	});
	swarm.join(db.discoveryKey, {
		lookup: false,
		announce: true,
	});
};

//autorun main if this file is called as an executable
if (require.main === module) {
	if (process.argv[process.argv.length - 1] === "forever") {
		main(Buffer.from(process.argv[process.argv.length - 2], "hex"));
	} else {
		console.log("spawning hyperbuddy to live forever!!!");

		spawn(
			"node",
			[require.main.filename, ...process.argv.slice(2), "forever"],
			{
				detached: true,
			},
		).unref();
		process.exit(0);
	}
}
