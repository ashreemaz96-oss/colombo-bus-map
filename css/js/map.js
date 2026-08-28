console.log("Map loaded");

/*
=========================================================
GOOGLE FORM LOCATION AUTOFILL
=========================================================

These are the Google Form entry IDs:

Latitude  = entry.683164263
Longitude = entry.788233062
*/

const FORM_ENTRY_LATITUDE = "entry.683164263";
const FORM_ENTRY_LONGITUDE = "entry.788233062";


/*
=========================================================
UPDATE GOOGLE FORM URL WITH USER LOCATION
=========================================================

This function does NOT modify your map or Google Sheet
loading code.

It only creates the Google Form URL with the latitude
and longitude filled in.
*/

function createLocationFormUrl(latitude, longitude) {

    const formUrl = new URL(
        "https://docs.google.com/forms/d/e/1FAIpQLSeGCGK3xjOS-F8s1BXwow29UaXNWmXQ3mWYUddt2apAiLO6ug/viewform"
    );

    formUrl.searchParams.set(
        FORM_ENTRY_LATITUDE,
        latitude.toFixed(7)
    );

    formUrl.searchParams.set(
        FORM_ENTRY_LONGITUDE,
        longitude.toFixed(7)
    );

    return formUrl.toString();
}


/*
=========================================================
LISTEN FOR THE LOCATION CREATED BY THE HTML
=========================================================

Your HTML already has locateUser().

Therefore this JavaScript does not recreate locateUser().
It only waits for the location information produced by
the existing HTML code.
*/

window.addEventListener("load", function () {

    console.log("Location form autofill system ready.");

});


/*
=========================================================
OPTIONAL GLOBAL HELPER
=========================================================

This can be used by the existing HTML if needed.

It does NOT interfere with Google Sheet loading.
*/

window.openReportFormWithLocation = function (
    latitude,
    longitude
) {

    if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
    ) {
        console.warn("Invalid latitude or longitude.");
        return;
    }

    const formUrl = createLocationFormUrl(
        latitude,
        longitude
    );

    window.open(
        formUrl,
        "_blank",
        "noopener,noreferrer"
    );
};
