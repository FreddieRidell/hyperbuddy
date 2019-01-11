import hyperdb from "hyperdb";
import net from "net";
import ram from "random-access-memory";
const { main, connectToBuddy } = require("../");

const defaultPort = 12237;

describe("hyperbuddy", () => {
	let prewrittenDB;
	let cloneDB;
	let closeServer;

	beforeEach(async () => {
		prewrittenDB = hyperdb(ram, { valueEncoding: "utf-8" });
		await new Promise(done => prewrittenDB.ready(done));
		cloneDB = hyperdb(ram, prewrittenDB.key, { valueEncoding: "utf-8" });
		await new Promise(done => cloneDB.ready(done));

		await Promise.all([
			[["foo", "ffoooo"], ["bar", "bbaarr"], ["qux", "qquuxx"]].map(
				([key, value]) =>
					new Promise(done => prewrittenDB.put(key, value, done)),
			),
		]);

		closeServer = await main();
	});

	afterEach(async () => {
		await closeServer();
	});

	describe("main", () => {
		it("creates a server when run", async () => {
			expect.assertions(1);

			const isInUse = await isPortTaken(defaultPort);

			expect(isInUse).toBe(true);
		});

		it("responds with a number when a hyperdb public key is sent to that port", async () => {
			expect.assertions(1);

			const socket = await createSocketConnectedToPort(defaultPort);

			const responseNumber = await new Promise(done => {
				socket.on("data", buf => done(parseInt(buf.toString(), 10)));
				socket.write(prewrittenDB.key);
			});

			expect(/^\d+$/.test("" + responseNumber)).toBe(true);
		});

		it("creates a socket on the port coresponding to that number", async () => {
			expect.assertions(1);

			const socket = await createSocketConnectedToPort(defaultPort);

			const responseNumber = await new Promise(done => {
				socket.on("data", buf => done(parseInt(buf.toString(), 10)));
				socket.write(prewrittenDB.key);
			});

			const isInUse = await isPortTaken(responseNumber);

			expect(isInUse).toBe(true);
		});

		it("accepts a hyperdb replication stream into that port", async () => {
			expect.assertions(1);

			const initialSocket = await createSocketConnectedToPort(
				defaultPort,
			);
			const responseNumber = await new Promise(done => {
				initialSocket.on("data", buf =>
					done(parseInt(buf.toString(), 10)),
				);
				initialSocket.write(prewrittenDB.key);
			});

			expect(async () => {
				const rStream = prewrittenDB.replicate({
					live: false,
				});

				const replicationSocket = await createSocketConnectedToPort(
					responseNumber,
				);

				rStream.pipe(replicationSocket).pipe(rStream);
			}).not.toThrow();
		});

		it("closes the port when replication is complete", async () => {
			expect.assertions(1);

			const initialSocket = await createSocketConnectedToPort(
				defaultPort,
			);
			const responseNumber = await new Promise(done => {
				initialSocket.on("data", buf =>
					done(parseInt(buf.toString(), 10)),
				);
				initialSocket.write(prewrittenDB.key);
			});

			await new Promise(async (done, fail) => {
				const rStream = prewrittenDB.replicate({
					live: false,
				});

				rStream.on("end", done);
				rStream.on("error", fail);

				const replicationSocket = await createSocketConnectedToPort(
					responseNumber,
				);

				rStream.pipe(replicationSocket).pipe(rStream);
			});

			expect(true).toBe(true);
		});

		it("will re-replicate the same data to an new hyperdb replication connection with the same public key", async () => {
			expect.assertions(3);

			const initialSocket = await createSocketConnectedToPort(
				defaultPort,
			);
			const initialPort = await new Promise(done => {
				initialSocket.on("data", buf =>
					done(parseInt(buf.toString(), 10)),
				);
				initialSocket.write(prewrittenDB.key);
			});

			await new Promise(async (done, fail) => {
				const rStream = prewrittenDB.replicate({
					live: false,
				});
				rStream.on("end", done);
				rStream.on("error", fail);

				const replicationSocket = await createSocketConnectedToPort(
					initialPort,
				);

				rStream.pipe(replicationSocket).pipe(rStream);
			});

			//set everything up just the way I want it, now do the new bit of the test:

			const secondSocket = await createSocketConnectedToPort(defaultPort);

			const secondPort = await new Promise(done => {
				secondSocket.on("data", buf =>
					done(parseInt(buf.toString(), 10)),
				);
				secondSocket.write(cloneDB.key);
			});

			await new Promise(async (done, fail) => {
				const rStream = cloneDB.replicate({
					live: false,
				});
				rStream.on("end", done);
				rStream.on("error", fail);

				const replicationSocket = await createSocketConnectedToPort(
					secondPort,
				);

				rStream.pipe(replicationSocket).pipe(rStream);
			});

			const [foo, bar, qux] = await Promise.all(
				["foo", "bar", "qux"].map(
					key =>
						new Promise(done =>
							cloneDB.get(key, (err, [{ value }]) => done(value)),
						),
				),
			);

			expect(foo).toBe("ffoooo");
			expect(bar).toBe("bbaarr");
			expect(qux).toBe("qquuxx");
		});
	});
});

//from https://gist.github.com/timoxley/1689041
const isPortTaken = port =>
	new Promise((done, fail) => {
		const net = require("net");
		const tester = net
			.createServer()
			.once("error", function(err) {
				if (err.code != "EADDRINUSE") return fail(err);
				done(true);
			})
			.once("listening", function() {
				tester
					.once("close", function() {
						done(false);
					})
					.close();
			})
			.listen(port);
	});

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
