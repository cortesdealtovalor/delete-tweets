require('dotenv').config();
const fs = require('fs');
const { TwitterApi } = require("twitter-api-v2");
const crypto = require('crypto');
const OAuth = require('oauth-1.0a');
const qs = require('querystring');
const got = require('got');
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});
const store = require('store');
var open = require("open-uri");

if (typeof localStorage === "undefined" || localStorage === null) {
  var LocalStorage = require('node-localstorage').LocalStorage;
  localStorage = new LocalStorage('./scratch');
}

// Get args
const argv = require('yargs')
    .usage('Usage: $0 [options]')
    .alias('d', 'date')
    .nargs('d', 1)
    .describe('d', 'date used to delete tweets in yyyy-mm-dd')
    .alias('n', 'number')
    .nargs('n', 1)
    .describe('n', 'number of tweets to delete')
    .default('n', 100)
    .demand(['d'])
    .help('h')
    .alias('h', 'help')
    .argv;


// Init variables
let tweetData;
let results = [];
let count = 0;
const cutOffDate = Date.parse(argv.d);
const client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN_KEY,
      accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET
});


const requestTokenURL = "https://api.twitter.com/oauth/request_token?oauth_callback=oob";
const authorizeURL = new URL("https://api.twitter.com/oauth/authorize");
const accessTokenURL = "https://api.twitter.com/oauth/access_token";
const oauth = OAuth({
  consumer: {key: process.env.TWITTER_API_KEY, secret: process.env.TWITTER_API_SECRET},
  signature_method: "HMAC-SHA1",
  hash_function: (baseString, key) => crypto.createHmac("sha1", key).update(baseString).digest("base64"),
});

async function input(prompt) {
  return new Promise(async (resolve, reject) => {
    readline.question(prompt, (out) => {
      readline.close();
      resolve(out);
    });
  });
}

async function requestToken() {
  const authHeader = oauth.toHeader(
    oauth.authorize({
      url: requestTokenURL,
      method: "POST",
    })
  );
  const req = await got.post(requestTokenURL, {
    headers: {
      Authorization: authHeader["Authorization"],
    },
  });
  if (req.body) {
    return qs.parse(req.body);
  } else {
    throw new Error("Cannot get an OAuth request token");
  }
}

async function accessToken({ oauth_token, oauth_token_secret }, verifier) {
  const authHeader = oauth.toHeader(
    oauth.authorize({
      url: accessTokenURL,
      method: "POST",
    })
  );
  const path = "https://api.twitter.com/oauth/access_token?oauth_verifier=" + verifier + "&oauth_token=" + oauth_token;
  const req = await got.post(path, {
    headers: {
      Authorization: authHeader["Authorization"],
    },
  });
  if (req.body) {
    localStorage.setItem('aToken', JSON.stringify(qs.parse(req.body)));
    return qs.parse(req.body);
  } else {
    throw new Error("Cannot get an OAuth request token");
  }
}

async function getRequest({ oauth_token, oauth_token_secret }, id) {
      const token = {
        key: oauth_token,
        secret: oauth_token_secret,
      };

      const endpointURL = "https://api.twitter.com/2/tweets/" + id;
      const authHeader = oauth.toHeader(
        oauth.authorize(
          {
            url: endpointURL,
            method: "DELETE",
          },
         token
        )
      );


      const req = await got.delete(endpointURL, {
        responseType: "json",
        headers: {
          "Authorization" : authHeader["Authorization"],
          "user-agent": "v2DeleteTweetJS",
          "content-type": "application/json",
          "accept": "application/json",
        },
      }, function(err){
        console.log("ERR : " + err);
      });



      if (req.body) {
        return req.body;
      } else {
        console.log("error ...");
        throw new Error("Unsuccessful request");
      }

}


async function deleteTweets(oAuthAccessToken, index){

   try{

       var tweet = Object.values(tweetData)[index]["tweet"];
       const id_str = tweet.id;
       const created_at = new Date(tweet.created_at);
       var delayInMilliseconds = 10000;


        if (!results.includes(id_str) && count < argv.n && created_at < cutOffDate) {
            console.log("Checking tweet : " + id_str + ", created at : " + created_at);
            const t = await client.v1.deleteTweet(id_str).catch(err =>{
                 console.log('Error while deleting ' + id_str);
                 console.log(err);
                 if(err.errors != null){
                   if(err.errors[0].code == 34 || err.errors[0].code == 144){
                        results.push(id_str);
                        writeResult(results);
                   }
                 }
                 setTimeout(function(){ deleteTweets(oAuthAccessToken, ++index); }, delayInMilliseconds);
            });
            if(t != null){
                var text = t.full_text;
                if(text != null){
                      console.log(text);
                      results.push(id_str);
                      count++;
                      console.log("Deleted successfully");
                      writeResult(results);
                      setTimeout(function(){ deleteTweets(oAuthAccessToken, ++index); }, delayInMilliseconds);
                }
            }
        }else{
            if(count >= argv.n || created_at >= cutOffDate){

                if(count == 0){
                    console.log("Try a different date. Maybe one month after the last one");
                }else{
                    console.log("This script erased " + count + " tweets");
                }
                process.exit();

            }else{
                setTimeout(function(){ deleteTweets(oAuthAccessToken, ++index); }, 5);
            }
        }



   }catch(e){
     console.log(e);
     process.exit(1);
   }

}

(async () => {

    // Parse JSONs
    try {
        console.log("Reading data....");
        console.log("(may take a while if deleted tweets surpass 3k). Please be patient.");
        tweetData = await JSON.parse(readJson('./tweets.js'));
        tweetData.sort(function(a, b){
            return new Date(a["tweet"]["created_at"]).getTime() - new Date(b["tweet"]["created_at"]).getTime();
        });
        results = JSON.parse(readJson('./deleted.js'));

        // Get access and delete
        var aToken = localStorage.getItem('aToken');
        var response = {};

        if(aToken != null && aToken != "undefined"){

            deleteTweets(JSON.parse(aToken), 0);
        }else{
            const oAuthRequestToken = await requestToken();
            authorizeURL.searchParams.append("oauth_token",oAuthRequestToken.oauth_token);
            console.log("Please accept this url and authorize:", authorizeURL.href);
            require("openurl").open(authorizeURL.href);
            const pin = await input("Paste the PIN here: ");
            const oAuthAccessToken = await accessToken(oAuthRequestToken, pin.trim());
            deleteTweets(oAuthAccessToken, 0);
        }

    } catch (e) {
        console.error(e);
        process.exit(1);

    }




})();


function customSort(a, b) {
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
}

function readJson(filename) {
    return fs.readFileSync(`./${filename}`, 'utf8', function (err, data) {
        if (err) throw err;
        return data;
    }).replace(/window.YTD.tweets.part0 = /g, '');
}

function writeResult(results) {

fs.writeFile("./deleted.js", JSON.stringify(results), function(err) {
    if (err) {
        console.log(err);
    }

});



}
