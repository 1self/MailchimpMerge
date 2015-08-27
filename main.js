var requestModule = require('request');
var express = require("express");
var morgan = require('morgan');
var bodyParser = require('body-parser');
var app = express();
app.use(morgan('combined'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
// app.use(express.bodyParser());




app.all('*', function(req, res, next) {
  	res.header('Access-Control-Allow-Origin', '*');
   	res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
    res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,accept,x-requested-with,x-withio-delay');
	  next();
 });


app.get('/doMailchimpMerge', function(request, response) {
  var gSplitCSVData, gMailchimpMembers;

  var onUpdateCompletion = function(formattedData, completionData) {
    formattedData.completionData = completionData;
    response.send(formattedData);
  };

  var tryToContinue = function(splitCSVData, mailchimpMembers) {
    var formattedData = { completionData: 'empty', readyForUpdate: [], noSublimeData: [], noMCMatch: []};

    if (splitCSVData) {
      createFriendlyFields(splitCSVData.hasSublimeData);
      gSplitCSVData = splitCSVData;
    }

    if (mailchimpMembers) {
      gMailchimpMembers = mailchimpMembers;
    }

    if (gMailchimpMembers && gSplitCSVData) {
      // got both halves so do match up and complete
      formattedData.noSublimeData = gSplitCSVData.noSublimeData;

      for (var i = 0; i < gSplitCSVData.hasSublimeData.length; i++) {
        var csvMember = gSplitCSVData.hasSublimeData[i];
        var matchedMCMember = null;
        for (var j = 0; j < gMailchimpMembers.length; j++) {
          var mcMember = gMailchimpMembers[j];
          if (mcMember.email_address === csvMember.primary_email_address || mcMember.email_address === csvMember.email_address) {
            matchedMCMember = mcMember;
            break;
          }
        }
        if (matchedMCMember) {
          csvMember.MCId = matchedMCMember.id;
          csvMember.MCFName = matchedMCMember.merge_fields.FNAME;
          csvMember.MCLName = matchedMCMember.merge_fields.LNAME;
          formattedData.readyForUpdate.push(csvMember);
        } else {
          formattedData.noMCMatch.push(csvMember);
        }
      }
      updateMC(formattedData, onUpdateCompletion);
      // response.send(formattedData);
    }
  };

  var onCSVSuccess = function(CSVData) {

    var splitData  = { noSublimeData: [], hasSublimeData: [] };

    for (var i = 0; i < CSVData.length; i++) {
      var member = CSVData[i];
      if (member.sublime_time !== "")
        splitData.hasSublimeData.push(member);
      else
        splitData.noSublimeData.push(member);
    }

    tryToContinue(splitData);
  };

  var onCSVError = function(error, errorResponse) {
    console.log(error);
    response.send(errorResponse);
  };

  var onMCSuccess = function(mcMembers) {
    tryToContinue(null, mcMembers);
  };

  var onMCError = function(mcError, mcResponse) {
    console.log(mcError);
    response.send(mcResponse);
  };

  getCSV(onCSVSuccess, onCSVError);
  getMailchimpMembers(onMCSuccess, onMCError);

});

function createFriendlyFields(CSVData) {
  var moment = require('moment');

  for (var i = 0; i < CSVData.length; i++) {
    var member = CSVData[i];
    
    if (member.sublime_day !== "") {
      var sublimeDay = moment(member.sublime_day, "MM/DD/YYYY");
      member.sublime_day_friendly = sublimeDay.format("dddd, Do MMMM");
    }

    if (member.sublime_time !== "") {
      var sublimeTimeSeconds = +member.sublime_time;
      var stHours = Math.floor(sublimeTimeSeconds / 3600);
      var stMins = Math.floor((sublimeTimeSeconds - (3600 * stHours)) / 60);
      var stSecs = sublimeTimeSeconds - (3600 * stHours) - (60 * stMins);

      var stFriendly;
      if (stSecs === 1) 
        stFriendly = stSecs + " second";
      else
        stFriendly = stSecs + " seconds";

      if (stMins > 0 || stHours > 0) {
        if (stMins === 1)
          stFriendly = stMins + " minute, " + stFriendly;
        else
          stFriendly = stMins + " minutes, " + stFriendly;
      }

      if (stHours > 0) {
        if (stHours === 1)
          stFriendly = stHours + " hour, " + stFriendly;
        else
          stFriendly = stHours + " hours, " + stFriendly;
      }
      member.sublime_time_friendly = stFriendly;
    }

    if (member.display_name !== "") {
      var fullName = member.display_name.split(' ');
      if (fullName.length === 2) {
        member.first_name = fullName[0];
        member.last_name = fullName[1];
      }
    }
  }
}

function getCSV(onSuccess, onError) {
  var csvParse = require('csv-parse');
  var fs = require('fs');

  fs.readFile('mailout.csv', 'utf8', function (err, data) {
    if (err) {
      onError(err, data);
    } else {
      csvParse(data, {columns:true}, function (parseErr, parseOutput) {
        if (parseErr) {
          onError(parseErr, parseOutput);
        } else {
          console.log('finished reading file');
          onSuccess(parseOutput);
        }
      });
    }
  });
}

function getMailchimpMembers(onSuccess, onError) {

  var MC_API = process.env.MAILCHIMP_API_KEY;
  var MC_LIST_ID = process.env.MAILCHIMP_THANKS_LIST_ID;
  var API_HOST = "https://us8.api.mailchimp.com/3.0/";
  var username = "john"; // this isn't used by the MC auth process    
  var url = API_HOST + "lists/" + MC_LIST_ID + "/members?count=400";
  var auth = "Basic " + new Buffer(username + ":" + MC_API).toString("base64");

  requestModule(
    {
        url : url,
        headers : {
            "Authorization" : auth
        }
    },
    function (error, innerResponse, body) {
        // console.log(body);
        if (!error) {
          console.log('got response from mailchimp');
          var members = JSON.parse(body).members;
          console.log(members);
          onSuccess(members);
        } else {
          onError(error, innerResponse);
        }
    }
  );
}

function updateMC(formattedData, callback) {

  var completions = {};
  completions.successes = [];
  completions.errors = [];

  var onSuccess = function(memberMCId) {
    console.log('update success: ' + memberMCId);
    completions.successes.push({memberMCId: memberMCId});
    if (completions.successes.length + completions.errors.length === formattedData.readyForUpdate.length)
      callback(formattedData, completions);
  };

  var onError = function(memberMCId, err) {
    console.log('update error: ' + memberMCId, err);
    completions.errors.push({memberMCId: memberMCId, err: err});
    if (completions.successes.length + completions.errors.length === formattedData.readyForUpdate.length)
      callback(formattedData, completions);
  };

  for (var i = 0; i < formattedData.readyForUpdate.length; i++) {
    updateMergeFields(formattedData.readyForUpdate[i], onSuccess, onError);
  }
}

function updateMergeFields(member, onSuccess, onError) { 

  var MC_API = process.env.MAILCHIMP_API_KEY;
  var MC_LIST_ID = process.env.MAILCHIMP_THANKS_LIST_ID;
  var API_HOST = "https://us8.api.mailchimp.com/3.0/";

  var username = "john"; // this isn't used by the MC auth process
    
  var url = API_HOST + "lists/" + MC_LIST_ID + "/members/" + member.MCId;
  var auth = "Basic " + new Buffer(username + ":" + MC_API).toString("base64");

  var mergeFields = {};

  mergeFields.SUBLIMEDAY = member.sublime_day_friendly;
  mergeFields.SUBLIMETIM = member.sublime_time_friendly;

  if (member.MCFName === "" && member.first_name && member.first_name !== "")
    mergeFields.FNAME = member.first_name;

  if (member.MCLName === "" && member.last_name && member.last_name !== "")
    mergeFields.LNAME = member.last_name;

  // console.log(mergeFields);

  requestModule(
    {
        url : url,
        headers : {
            "Authorization" : auth
        },
        method: 'PATCH',
        json: {
            merge_fields : mergeFields
        }
    },
    function (error, innerResponse, body) {
        if (!error) {
          // console.log(innerResponse);
          onSuccess(member.MCId);
        } else {
          onError(member.MCId, error);
        }
    }
  );
}




var port = process.env.PORT || 5000;
console.log(port);
app.listen(port, function() {
  console.log("Listening on " + port);
});