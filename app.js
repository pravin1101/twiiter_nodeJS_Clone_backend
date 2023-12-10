const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const dbPath = path.join(__dirname, "twitterClone.db");
const app = express();

app.use(express.json());

let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({ filename: dbPath, driver: sqlite3.Database });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(-1);
  }
};
initializeDBAndServer();

// Middleware Function TO Authenticate JWT Token
const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        console.error("JWT Verification Error:", error);
        response.send("Invalid JWT Token");
      } else {
        console.log("Decoded JWT Payload:", payload);
        request.user = { user_id: payload.user_id, username: payload.username }; // Change this line
        next();
      }
    });
  }
};

//API 1 = register user API

app.post("/register/", async (request, response) => {
  const { username, name, password, gender } = request.body;
  if (password.length < 6) {
    response.status(400).send("Password is too short");
  } else {
    const hashedPassword = await bcrypt.hash(request.body.password, 10);
    const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
    const dbUser = await db.get(selectUserQuery);
    if (dbUser === undefined) {
      const createUserQuery = `
            INSERT INTO 
                user (username, name, password, gender) 
            VALUES 
                (
                '${username}', 
                '${name}',
                '${hashedPassword}', 
                '${gender}'
                )`;
      await db.run(createUserQuery);
      response.send(`User created successfully`);
    } else {
      response.status(400);
      response.send("User already exists");
    }
  }
});

// API 2 = Login API
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `
    SELECT
      *
    FROM
      user
    WHERE 
      username = '${username}';`;
  const dbUser = await db.get(selectUserQuery);

  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = { username: username, user_id: dbUser.user_id };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");

      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//API 3
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const userId = request.user.user_id;

  // Query to get the user_ids of the people whom the user follows
  const followingQuery =
    "SELECT following_user_id FROM follower WHERE follower_user_id = ?";
  const followingUserIds = await db.all(followingQuery, [userId]);

  // Extracting user_ids from the result
  const followingIds = followingUserIds.map((user) => user.following_user_id);

  // Query to get the latest 4 tweets of the following users
  const tweetsQuery = `
    SELECT t.tweet_id, t.tweet, t.date_time, u.username
    FROM tweet AS t
    JOIN user AS u ON t.user_id = u.user_id
    WHERE t.user_id IN (${followingIds.join(",")})
    ORDER BY t.date_time DESC
    LIMIT 4;
  `;

  const tweets = await db.all(tweetsQuery);

  const formattedTweets = tweets.map((tweet) => ({
    tweet_id: tweet.tweet_id,
    username: tweet.username,
    tweet: tweet.tweet,
    dateTime: tweet.date_time,
  }));

  response.json(formattedTweets);
});

// API 4: Get the list of people whom the user follows
app.get("/user/following/", authenticateToken, async (request, response) => {
  try {
    const userId = request.user.user_id;

    // Query to get the names of people whom the user follows
    const followingQuery = `
      SELECT u.name
      FROM user AS u
      JOIN follower AS f ON u.user_id = f.following_user_id
      WHERE f.follower_user_id = ?;
    `;

    const followingList = await db.all(followingQuery, [userId]);

    const formattedFollowingList = followingList.map((user) => ({
      name: user.name,
    }));

    response.json(formattedFollowingList);
  } catch (error) {
    console.error("Error retrieving following list:", error);
    response.status(500).send("Internal Server Error");
  }
});

// API 5: Get the list of people who follow the user
app.get("/user/followers/", authenticateToken, async (request, response) => {
  try {
    const userId = request.user.user_id;

    // Query to get the names of people who follow the user
    const followersQuery = `
      SELECT u.name
      FROM user AS u
      JOIN follower AS f ON u.user_id = f.follower_user_id
      WHERE f.following_user_id = ?;
    `;

    const followersList = await db.all(followersQuery, [userId]);

    const formattedFollowersList = followersList.map((user) => ({
      name: user.name,
    }));

    response.json(formattedFollowersList);
  } catch (error) {
    console.error("Error retrieving followers list:", error);
    response.status(500).send("Internal Server Error");
  }
});

// API 6: Get tweet details by tweet ID
app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  try {
    const userId = request.user.user_id;
    const tweetId = request.params.tweetId;

    // Query to get tweet details
    const tweetQuery = `
      SELECT t.tweet, COUNT(l.user_id) AS likes, COUNT(r.reply_id) AS replies, t.date_time
      FROM tweet AS t
      LEFT JOIN like AS l ON t.tweet_id = l.tweet_id
      LEFT JOIN reply AS r ON t.tweet_id = r.tweet_id
      WHERE t.tweet_id = ? AND (t.user_id = ? OR t.user_id IN (SELECT following_user_id FROM follower WHERE follower_user_id = ?))
      GROUP BY t.tweet_id;
    `;

    const tweetDetails = await db.get(tweetQuery, [tweetId, userId, userId]);

    if (!tweetDetails) {
      response.status(401).send("Invalid Request");
    } else {
      response.json({
        tweet: tweetDetails.tweet,
        likes: tweetDetails.likes,
        replies: tweetDetails.replies,
        dateTime: tweetDetails.date_time,
      });
    }
  } catch (error) {
    console.error("Error retrieving tweet details:", error);
    response.status(500).send("Internal Server Error");
  }
});

// API 7: Get likes for a tweet by tweet ID
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    try {
      const userId = request.user.user_id;
      const tweetId = request.params.tweetId;

      // Query to get likes for a tweet
      const likesQuery = `
      SELECT u.username
      FROM like AS l
      JOIN user AS u ON l.user_id = u.user_id
      WHERE l.tweet_id = ? AND (l.tweet_id IN (SELECT tweet_id FROM tweet WHERE user_id = ?) OR l.tweet_id IN (SELECT tweet_id FROM tweet WHERE user_id IN (SELECT following_user_id FROM follower WHERE follower_user_id = ?)));
    `;

      const likesList = await db.all(likesQuery, [tweetId, userId, userId]);

      if (!likesList.length) {
        response.status(401).send("Invalid Request");
      } else {
        const formattedLikesList = likesList.map((user) => user.username);
        response.json({ likes: formattedLikesList });
      }
    } catch (error) {
      console.error("Error retrieving likes for tweet:", error);
      response.status(500).send("Internal Server Error");
    }
  }
);

// API 8: Get replies for a tweet by tweet ID
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    try {
      const userId = request.user.user_id;
      const tweetId = request.params.tweetId;

      // Query to get replies for a tweet
      const repliesQuery = `
      SELECT u.name, r.reply
      FROM reply AS r
      JOIN user AS u ON r.user_id = u.user_id
      WHERE r.tweet_id = ? AND (r.tweet_id IN (SELECT tweet_id FROM tweet WHERE user_id = ?) OR r.tweet_id IN (SELECT tweet_id FROM tweet WHERE user_id IN (SELECT following_user_id FROM follower WHERE follower_user_id = ?)));
    `;

      const repliesList = await db.all(repliesQuery, [tweetId, userId, userId]);

      if (!repliesList.length) {
        response.status(401).send("Invalid Request");
      } else {
        const formattedRepliesList = repliesList.map((reply) => ({
          name: reply.name,
          reply: reply.reply,
        }));
        response.json({ replies: formattedRepliesList });
      }
    } catch (error) {
      console.error("Error retrieving replies for tweet:", error);
      response.status(500).send("Internal Server Error");
    }
  }
);

// API 9: Get tweets of the user
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  try {
    const userId = request.user.user_id;

    // Query to get tweets of the user
    const userTweetsQuery = `
      SELECT t.tweet, COUNT(l.user_id) AS likes, COUNT(r.reply_id) AS replies, t.date_time
      FROM tweet AS t
      LEFT JOIN like AS l ON t.tweet_id = l.tweet_id
      LEFT JOIN reply AS r ON t.tweet_id = r.tweet_id
      WHERE t.user_id = ?
      GROUP BY t.tweet_id;
    `;

    const userTweets = await db.all(userTweetsQuery, [userId]);

    const formattedUserTweets = userTweets.map((tweet) => ({
      tweet: tweet.tweet,
      likes: tweet.likes,
      replies: tweet.replies,
      dateTime: tweet.date_time,
    }));

    response.json(formattedUserTweets);
  } catch (error) {
    console.error("Error retrieving user tweets:", error);
    response.status(500).send("Internal Server Error");
  }
});

// API 10: Create a tweet
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  try {
    const userId = request.user.user_id;
    const { tweet } = request.body;

    // Query to insert a new tweet
    const createTweetQuery = `
      INSERT INTO tweet (user_id, tweet, date_time)
      VALUES (?, ?, datetime('now'));
    `;

    await db.run(createTweetQuery, [userId, tweet]);

    response.send("Created a Tweet");
  } catch (error) {
    console.error("Error creating tweet:", error);
    response.status(500).send("Internal Server Error");
  }
});

// API 11: Delete a tweet by tweet ID
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    try {
      const userId = request.user.user_id;
      const tweetId = request.params.tweetId;

      // Query to delete a tweet
      const deleteTweetQuery = `
      DELETE FROM tweet
      WHERE tweet_id = ? AND user_id = ?;
    `;

      const result = await db.run(deleteTweetQuery, [tweetId, userId]);

      if (result.changes === 0) {
        response.status(401).send("Invalid Request");
      } else {
        response.send("Tweet Removed");
      }
    } catch (error) {
      console.error("Error deleting tweet:", error);
      response.status(500).send("Internal Server Error");
    }
  }
);

module.exports = app;
