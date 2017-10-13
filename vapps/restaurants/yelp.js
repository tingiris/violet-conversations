
var yelp = require('yelp-fusion');

var clientId = process.env.YELP_CLIENT_ID;
var clientSecret = process.env.YELP_CLIENT_SECRET;

var lat = null;
var lon = null;

var client = null;

module.exports.init = (_lat, _lon) => {
  lat = _lat;
  lon = _lon;
  return yelp.accessToken(clientId, clientSecret).then(resp => {
    var token = resp.jsonBody.access_token;
    client = yelp.client(token);
  });
}

var search = module.exports.search = (searchTerm, categories, processBusinessesCB, offset=0, max=100) => {
  var params = {
    latitude: lat,
    longitude: lon,
    limit: 50
  }
  if (offset>0) params.offset = offset;
  if (searchTerm) params.term = searchTerm;
  if (categories) params.categories = categories;

  return client.search(params).then(response => {
    console.log('total results: ' + response.jsonBody.total);
    console.log('results: ' + response.jsonBody.businesses.length);
    processBusinessesCB(response.jsonBody.businesses);

    var totalProcessed = offset+response.jsonBody.businesses.length;

    delete response.jsonBody.businesses;
    console.log(response.jsonBody);

    if (response.jsonBody.total>totalProcessed && totalProcessed<max)
      return search(searchTerm, categories, processBusinessesCB, totalProcessed, max);
  });
}

// return client.reviews('coriander-indian-bistro-sharon').then(response => {
//   console.log(response.jsonBody.reviews);
// });
